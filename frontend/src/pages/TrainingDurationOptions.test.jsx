import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../i18n/localeStore.js";
import MagneticInputLabPage from "./MagneticInputLabPage.jsx";
import SensitivityLabPage from "./SensitivityLabPage.jsx";

vi.mock("../api/trainingApi", () => ({
  createInputAnalysis: vi.fn(),
  createSensitivityRecommendation: vi.fn(),
  fetchInputHistory: vi.fn(() => new Promise(() => {})),
  fetchSensitivityHistory: vi.fn(() => new Promise(() => {})),
}));

describe("training duration controls", () => {
  beforeEach(() => useLocaleStore.getState().hydrate("zh"));

  it("offers manual unlimited rounds in the sensitivity lab", () => {
    render(<SensitivityLabPage />);

    fireEvent.change(screen.getByLabelText("每轮测试时长"), { target: { value: "0" } });

    expect(screen.getByText(/6 × 不限时/)).toBeTruthy();
    expect(screen.getByRole("option", { name: "不限时（手动结束）" })).toBeTruthy();
  });

  it("offers a manual unlimited magnetic input session", () => {
    render(<MagneticInputLabPage />);

    fireEvent.change(screen.getByLabelText("测试时长"), { target: { value: "0" } });

    expect(screen.getByRole("option", { name: "不限时（手动结束）" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "开始输入测试" })).toBeTruthy();
  });
});
