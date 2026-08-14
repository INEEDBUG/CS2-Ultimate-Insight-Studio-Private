import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LeagueAccountTools from "./LeagueAccountTools";
import { claimLeagueMissionReward, deleteLeagueFriends } from "../../api/leagueLabApi";

vi.mock("../../api/leagueLabApi", () => ({
  claimLeagueMissionReward: vi.fn(),
  claimLeagueRewardGrant: vi.fn(),
  claimLeagueEventRewards: vi.fn(),
  deleteLeagueFriends: vi.fn(),
}));

const data = {
  claimable_missions: [{
    id: "mission-1",
    title: "选择一个奖励",
    status: "SELECT_REWARDS",
    rewardStrategy: { selectMinGroupCount: 1, selectMaxGroupCount: 1 },
    rewards: [
      { rewardGroup: "group-a", description: "蓝色精粹", quantity: 500 },
      { rewardGroup: "group-b", description: "随机皮肤", quantity: 1 },
    ],
  }],
  claimable_rewards: [],
  claimable_events: [],
  friends: [{ id: "friend-1", gameName: "Friend", gameTag: "CN1", puuid: "puuid-1" }],
};

const props = {
  data,
  busy: false,
  onBusyChange: vi.fn(),
  onRefresh: vi.fn().mockResolvedValue(undefined),
  onError: vi.fn(),
};

describe("LeagueAccountTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    props.onRefresh.mockResolvedValue(undefined);
    claimLeagueMissionReward.mockResolvedValue({ claimed: true });
    deleteLeagueFriends.mockResolvedValue({ count: 1 });
    window.prompt = vi.fn();
  });

  it("keeps account actions inert while the master protection is disabled", () => {
    render(<LeagueAccountTools {...props} enabled={false}/>);
    expect(screen.getAllByRole("checkbox").every((input)=>input.disabled)).toBe(true);
    expect(screen.getByRole("button", { name: "领取所选" }).disabled).toBe(true);
    expect(claimLeagueMissionReward).not.toHaveBeenCalled();
  });

  it("uses the exact explicitly selected mission reward and confirmation phrase", async () => {
    render(<LeagueAccountTools {...props} enabled/>);
    fireEvent.click(screen.getByRole("checkbox", { name: /随机皮肤/ }));
    window.prompt.mockReturnValueOnce("错误确认");
    fireEvent.click(screen.getByRole("button", { name: "领取所选" }));
    expect(claimLeagueMissionReward).not.toHaveBeenCalled();

    window.prompt.mockReturnValueOnce("我确认领取");
    fireEvent.click(screen.getByRole("button", { name: "领取所选" }));
    await waitFor(()=>expect(claimLeagueMissionReward).toHaveBeenCalledWith(
      "mission-1", ["group-b"], "我确认领取"
    ));
  });

  it("deletes only the explicitly checked friend after the delete phrase", async () => {
    render(<LeagueAccountTools {...props} enabled/>);
    fireEvent.click(screen.getByRole("checkbox", { name: /Friend#CN1/ }));
    window.prompt.mockReturnValueOnce("我确认删除");
    fireEvent.click(screen.getByRole("button", { name: "删除所选（1）" }));
    await waitFor(()=>expect(deleteLeagueFriends).toHaveBeenCalledWith(
      ["friend-1"], "我确认删除"
    ));
  });
});
