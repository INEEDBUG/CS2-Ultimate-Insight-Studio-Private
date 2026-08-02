import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import FirstRunWelcome, { FIRST_RUN_WELCOME_KEY, shouldShowFirstRunWelcome } from "./FirstRunWelcome";

vi.mock("../i18n/useT.js", () => ({ useT: () => (key) => key }));

describe("FirstRunWelcome", () => {
  beforeEach(() => localStorage.clear());

  test("only treats the current welcome version as completed", () => {
    expect(shouldShowFirstRunWelcome()).toBe(true);
    localStorage.setItem(FIRST_RUN_WELCOME_KEY, "done");
    expect(shouldShowFirstRunWelcome()).toBe(false);
  });

  test("remembers completion and opens the chosen workspace", () => {
    const onNavigate = vi.fn();
    render(<FirstRunWelcome open onNavigate={onNavigate} />);

    fireEvent.click(screen.getByText("welcome.demoTitle"));

    expect(localStorage.getItem(FIRST_RUN_WELCOME_KEY)).toBe("done");
    expect(onNavigate).toHaveBeenCalledWith("/match-history");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
