import { ChatGptPlan } from "../../capability/chatgpt/ChatGptPlan.ts";
import { terminalLine } from "../../text/text-utils.ts";

/** The line for a review the ChatGPT plan stopped, after an error or after a result. */
export function planStopMessage(failure: Error): string {
  return `the review stopped and gave no result: ${terminalLine(ChatGptPlan.failureMessage(failure))}`;
}
