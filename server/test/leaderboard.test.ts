import { test } from "node:test";
import assert from "node:assert/strict";
import { rankLeaderboard } from "../src/utils/leaderboard.js";

const board = [
  { name: "a", totalEarned: "10.0000", totalSales: 1, totalResources: 5 },
  { name: "b", totalEarned: "30.0000", totalSales: 2, totalResources: 1 },
  { name: "c", totalEarned: "20.0000", totalSales: 9, totalResources: 3 },
];

test("ranks by earnings descending by default", () => {
  const ranked = rankLeaderboard(board);
  assert.deepEqual(ranked.map((e) => e.name), ["b", "c", "a"]);
});

test("ranks by sales and by resources", () => {
  assert.deepEqual(
    rankLeaderboard(board, { sort: "sales" }).map((e) => e.name),
    ["c", "b", "a"]
  );
  assert.deepEqual(
    rankLeaderboard(board, { sort: "resources" }).map((e) => e.name),
    ["a", "c", "b"]
  );
});

test("breaks ties on earnings", () => {
  const tied = [
    { name: "low", totalEarned: "5.0000", totalSales: 4, totalResources: 0 },
    { name: "high", totalEarned: "8.0000", totalSales: 4, totalResources: 0 },
  ];
  assert.deepEqual(
    rankLeaderboard(tied, { sort: "sales" }).map((e) => e.name),
    ["high", "low"]
  );
});

test("limit trims to a top-N without mutating the input", () => {
  const top = rankLeaderboard(board, { limit: 2 });
  assert.deepEqual(top.map((e) => e.name), ["b", "c"]);
  assert.equal(board[0].name, "a");
});
