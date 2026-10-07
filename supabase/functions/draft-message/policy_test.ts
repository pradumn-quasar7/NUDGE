// deno test supabase/functions/draft-message/policy_test.ts
import {
  availableChannels,
  cleanBody,
  clock,
  guessLanguage,
  inferIntent,
  insideWindow,
  phoneDigits,
  preferredChannel,
  sendHint,
  windowPhrase,
} from "./policy.ts";

function eq<T>(actual: T, expected: T, what: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("phoneDigits normalises to E.164 digits", () => {
  eq(phoneDigits("+91 98200 11234"), "919820011234", "intl");
  eq(phoneDigits("09820011234"), "919820011234", "leading 0");
  eq(phoneDigits("98200 11234"), "919820011234", "10 digits");
  eq(phoneDigits("12"), null, "too short");
  eq(phoneDigits(null), null, "null");
});

Deno.test("channels follow the contact details we have", () => {
  eq(availableChannels({ phone: "+91 98200 11234", email: null }), ["whatsapp", "sms"], "phone");
  eq(availableChannels({ phone: null, email: "a@b.in" }), ["email"], "email");
  eq(availableChannels({ phone: null, email: "nope" }), [], "none");
  eq(preferredChannel(["whatsapp", "sms", "email"], "email", "whatsapp"), "email", "policy wins");
  eq(preferredChannel(["whatsapp", "sms"], "email", "whatsapp"), "whatsapp", "unavailable policy falls back");
  eq(preferredChannel(["whatsapp", "sms"], "call", null), "whatsapp", "call → whatsapp");
  eq(preferredChannel([], null, "email"), "email", "nothing available keeps the customer's channel");
});

Deno.test("intent inferred from the promise", () => {
  eq(inferIntent({ commitmentTitle: "Send revised quotation" }), "quote_follow_up", "quote");
  eq(inferIntent({ commitmentTitle: "Send payment link to Aman" }), "payment_reminder", "payment");
  eq(inferIntent({ suggestionBucket: "waiting" }), "check_in", "waiting");
  eq(inferIntent({ commitmentTitle: "Call Priya regarding delivery" }), "reply", "other");
});

Deno.test("quiet hours", () => {
  eq(clock("18:00:00"), "6 pm", "clock");
  eq(clock("09:30"), "9:30 am", "clock half");
  eq(clock("12:00"), "12 pm", "noon");
  eq(windowPhrase("18:00", "23:59"), "after 6 pm", "evening");
  eq(windowPhrase("21:00", "07:00"), "after 9 pm", "wraps");
  eq(windowPhrase("10:00", "20:00"), "between 10 am and 8 pm", "between");
  // 2026-10-07 10:00 UTC = 15:30 IST
  const now = new Date("2026-10-07T10:00:00Z");
  eq(insideWindow(now, "Asia/Kolkata", "18:00", "23:59"), false, "before window");
  eq(insideWindow(now, "Asia/Kolkata", "09:00", "17:00"), true, "inside");
  eq(insideWindow(now, "Asia/Kolkata", "21:00", "16:00"), true, "wrapping window");
  const base = { firstName: "Rahul", now, timeZone: "Asia/Kolkata", maxPerWeek: null, outboundLast7d: 0, method: null } as const;
  eq(sendHint({ ...base, hoursStart: "18:00:00", hoursEnd: "23:59:00" }), "Rahul prefers messages after 6 pm", "hint");
  eq(sendHint({ ...base, hoursStart: "09:00", hoursEnd: "17:00" }), null, "no hint inside");
  eq(sendHint({ ...base, hoursStart: null, hoursEnd: null, maxPerWeek: 2, outboundLast7d: 2 }), "You’ve messaged Rahul 2× this week · their limit is 2", "cap");
  eq(sendHint({ ...base, hoursStart: null, hoursEnd: null, method: "call" }), "Rahul usually prefers a call", "call");
});

Deno.test("language guess and body clean-up", () => {
  eq(guessLanguage(["Bhai kal tak quotation bhej do", "kitna hoga?"]), "Hinglish", "hinglish");
  eq(guessLanguage(["Can you send the revised quote?"]), "English", "english");
  eq(guessLanguage([]), "Unknown", "empty");
  eq(cleanBody('"Hi Rahul 🙂 here it is"', false), "Hi Rahul here it is", "quotes + emoji stripped");
  eq(cleanBody("Hi Rahul 🙂, done", false), "Hi Rahul, done", "no space before punctuation");
  eq(cleanBody("Hi 🙂", true), "Hi 🙂", "emoji kept when the customer uses them");
  eq(cleanBody("a\n\n\n\nb  ", false), "a\n\nb", "whitespace");
});
