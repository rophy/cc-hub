import { describe, it, expect } from "vitest";
import { formatHookEvent } from "../../src/activity-formatter.js";
import type { HookEvent } from "@cc-hub/shared";

function makeEvent(overrides: Partial<HookEvent>): HookEvent {
  return {
    session_id: "test-session",
    hook_event_name: "PostToolUse",
    ...overrides,
  };
}

describe("formatHookEvent", () => {
  it("formats UserPromptSubmit", () => {
    const msg = formatHookEvent(
      makeEvent({ hook_event_name: "UserPromptSubmit", prompt: "fix the bug" }),
    );
    expect(msg).toContain("Prompt");
    expect(msg).toContain("fix the bug");
  });

  it("formats PreToolUse for Bash", () => {
    const msg = formatHookEvent(
      makeEvent({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "npm test" },
      }),
    );
    expect(msg).toContain("Bash");
    expect(msg).toContain("npm test");
  });

  it("formats PreToolUse for Edit", () => {
    const msg = formatHookEvent(
      makeEvent({
        hook_event_name: "PreToolUse",
        tool_name: "Edit",
        tool_input: { file_path: "/src/index.ts" },
      }),
    );
    expect(msg).toContain("Edit");
    expect(msg).toContain("/src/index.ts");
  });

  it("formats PostToolUse with result", () => {
    const msg = formatHookEvent(
      makeEvent({
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_result: "PASS: 10 tests passed",
      }),
    );
    expect(msg).toContain("Bash");
    expect(msg).toContain("10 tests passed");
  });

  it("skips PostToolUse with empty result", () => {
    const msg = formatHookEvent(
      makeEvent({
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        tool_result: "",
      }),
    );
    expect(msg).toBeNull();
  });

  it("formats PostToolUseFailure", () => {
    const msg = formatHookEvent(
      makeEvent({
        hook_event_name: "PostToolUseFailure",
        tool_name: "Bash",
        error: "command not found: foo",
      }),
    );
    expect(msg).toContain("failed");
    expect(msg).toContain("command not found");
  });

  it("formats Stop", () => {
    const msg = formatHookEvent(makeEvent({ hook_event_name: "Stop" }));
    expect(msg).toContain("Turn complete");
  });

  it("formats SessionStart", () => {
    const msg = formatHookEvent(
      makeEvent({ hook_event_name: "SessionStart", source: "startup" }),
    );
    expect(msg).toContain("Session started");
    expect(msg).toContain("startup");
  });

  it("formats SessionEnd", () => {
    const msg = formatHookEvent(
      makeEvent({ hook_event_name: "SessionEnd", reason: "clear" }),
    );
    expect(msg).toContain("Session ended");
    expect(msg).toContain("clear");
  });

  it("formats SubagentStart", () => {
    const msg = formatHookEvent(
      makeEvent({
        hook_event_name: "SubagentStart",
        agent_type: "Explore",
        agent_name: "codebase search",
      }),
    );
    expect(msg).toContain("Subagent started");
    expect(msg).toContain("codebase search");
  });

  it("truncates long prompts", () => {
    const msg = formatHookEvent(
      makeEvent({
        hook_event_name: "UserPromptSubmit",
        prompt: "a".repeat(500),
      }),
    );
    expect(msg!.length).toBeLessThan(500);
    expect(msg).toContain("…");
  });

  it("returns null for unknown events", () => {
    const msg = formatHookEvent(makeEvent({ hook_event_name: "Unknown" }));
    expect(msg).toBeNull();
  });
});
