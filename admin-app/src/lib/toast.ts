import { readonly, ref } from "vue";
import type { ToastMessage } from "@/types";

const messages = ref<ToastMessage[]>([]);
let nextId = 1;

const remove = (id: number) => {
  messages.value = messages.value.filter((message) => message.id !== id);
};

const push = (kind: ToastMessage["kind"], text: string) => {
  const id = nextId++;
  messages.value.push({ id, kind, text });
  window.setTimeout(() => remove(id), kind === "error" ? 6000 : 3600);
};

export const toast = {
  messages: readonly(messages),
  success: (text: string) => push("success", text),
  error: (text: string) => push("error", text),
  info: (text: string) => push("info", text),
  remove,
};
