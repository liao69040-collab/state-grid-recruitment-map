/** Public edition: deployments must supply their own reviewed education pins.
 * The customer-specific corpus and approval hashes are intentionally omitted. */
type EducationPin = {
  key: string; unitKey: string; province: string; batch: string;
  sha256: string; sourceKeys: readonly string[];
};
type ScopedEducationPin = EducationPin & {
  scope: { sourceKey: string; bodySha256: string; text: string };
};
export const informationEducationPins: readonly (EducationPin | ScopedEducationPin)[] = [];
