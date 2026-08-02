import API from "./api";

export async function createSensitivityRecommendation(payload) {
  const { data } = await API.post("/training/sensitivity/recommend", payload);
  return data;
}

export async function fetchSensitivityHistory(limit = 20) {
  const { data } = await API.get("/training/sensitivity/history", { params: { limit } });
  return data;
}
