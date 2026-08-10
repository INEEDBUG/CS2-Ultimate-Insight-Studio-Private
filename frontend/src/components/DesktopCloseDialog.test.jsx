import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import DesktopCloseDialog from "./DesktopCloseDialog";

describe("DesktopCloseDialog", () => {
  test("offers tray, full exit, cancel, and remember choice", () => {
    const onChoice = vi.fn();
    const onCancel = vi.fn();
    const onRememberChange = vi.fn();
    render(
      <DesktopCloseDialog
        open
        remember={false}
        onChoice={onChoice}
        onCancel={onCancel}
        onRememberChange={onRememberChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /驻留后台|Keep running/ }));
    fireEvent.click(screen.getByRole("button", { name: /彻底退出|Exit completely/ }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getAllByRole("button", { name: /取消|Cancel/ }).at(-1));

    expect(onChoice).toHaveBeenNthCalledWith(1, "tray");
    expect(onChoice).toHaveBeenNthCalledWith(2, "exit");
    expect(onRememberChange).toHaveBeenCalledWith(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("renders nothing while closed", () => {
    const { container } = render(<DesktopCloseDialog open={false} />);
    expect(container.childElementCount).toBe(0);
  });
});
