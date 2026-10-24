/** Display only this atomic event's normalized timeline, never its parent itinerary. */
export interface RecruitmentEventTime {
  startsOn?: string | null;
  endsOn?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  timeStatus?: string | null;
  eventType?: string | null;
  title?: string;
  metadata?: Record<string, any> | null;
}

const zonedParts = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, clock: `${parts.hour}:${parts.minute}` };
};

const dateText = (value: unknown) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : zonedParts(raw)?.date;
  if (!day) return raw;
  const [year, month, date] = day.split("-");
  return `${year}年${Number(month)}月${Number(date)}日`;
};

// PostgreSQL normalizes 24:00 to the next day's 00:00. Preserve the original
// notation only when it describes this same instant, from this event's scope.
const originalEndOfDay = (event: RecruitmentEventTime, edge: "start" | "end", instant: string) => {
  const atomic = event.metadata?.rawAtomicTimeFields ?? {};
  const parent = event.metadata?.rawParentTimeFields ?? {};
  const ownsTimeline = ["start", "end", "startDate", "endDate", "startTime", "endTime", "date", "dates", "testDate", "time"]
    .some((key) => atomic[key] != null && String(atomic[key]).trim());
  const fields = ownsTimeline ? atomic : parent;
  const date = edge === "start"
    ? fields.startDate || fields.testDate || fields.date
    : fields.endDate || fields.date || fields.startDate;
  const clock = edge === "start" ? fields.startTime || fields.time : fields.endTime;
  const candidate = fields[edge] || (date && clock ? `${date}T${clock}:00+08:00` : "");
  const match = String(candidate).match(/^(\d{4}-\d{2}-\d{2})T24:00(?::00)?(?:\+08:00)?$/);
  if (!match) return null;
  const sourceInstant = `${match[1]}T24:00:00+08:00`;
  return Date.parse(sourceInstant) === Date.parse(instant) ? { date: match[1], clock: "24:00" } : null;
};

const edgeTime = (event: RecruitmentEventTime, edge: "start" | "end") => {
  const instant = edge === "start" ? event.startsAt : event.endsAt;
  if (!instant) return null;
  const parsed = zonedParts(instant);
  if (!parsed) return null;
  return originalEndOfDay(event, edge, instant) ?? parsed;
};

export const hasOfficialClockTime = (event: RecruitmentEventTime) => {
  if (/unpublished|unknown|not[_ -]?published|未公开|待定/.test(String(event.timeStatus ?? "").toLowerCase())) return false;
  return Boolean(edgeTime(event, "start") || edgeTime(event, "end"));
};

export const eventDate = (event: RecruitmentEventTime) => {
  const start = dateText(edgeTime(event, "start")?.date || event.startsOn);
  const end = dateText(edgeTime(event, "end")?.date || event.endsOn);
  if (start && end && start !== end) return `${start} — ${end}`;
  return start || end || "官方未公开日期";
};

export const eventClock = (event: RecruitmentEventTime) => {
  if (!hasOfficialClockTime(event)) return "具体时刻：官方未公开";
  const start = edgeTime(event, "start");
  const end = edgeTime(event, "end");
  const midnightNote = [start, end].some((part) => part?.clock === "24:00")
    ? "（24:00 等同次日 00:00）" : "";
  if (start && end && Date.parse(event.startsAt!) > Date.parse(event.endsAt!)) {
    return "起止时刻冲突，待核验原始来源";
  }
  if (start && end && start.date !== end.date) {
    return `${dateText(start.date)} ${start.clock} — ${dateText(end.date)} ${end.clock} 北京时间${midnightNote}`;
  }
  if (start && end && start.clock !== end.clock) return `${start.clock}–${end.clock} 北京时间${midnightNote}`;
  if (start) {
    const deadline = !end && /deadline|截止/.test(`${event.eventType ?? ""}${event.title ?? ""}`);
    return `${deadline ? "截至 " : ""}${start.clock} 北京时间${midnightNote}`;
  }
  return `截至 ${end!.clock} 北京时间${midnightNote}`;
};
