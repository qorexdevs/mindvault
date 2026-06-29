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

test("ranks by average revenue per sale", () => {
  // a: 10/1=10, b: 30/2=15, c: 20/9=2.22
  assert.deepEqual(
    rankLeaderboard(board, { sort: "avg_sale" }).map((e) => e.name),
    ["b", "a", "c"]
  );
});

test("ranks by average revenue per resource", () => {
  // a: 10/5=2, b: 30/1=30, c: 20/3=6.67
  assert.deepEqual(
    rankLeaderboard(board, { sort: "avg_resource" }).map((e) => e.name),
    ["b", "c", "a"]
  );
});

test("avg_resource sinks publishers with no resources to the bottom", () => {
  const withZero = [
    { name: "none", totalEarned: "9.0000", totalSales: 1, totalResources: 0 },
    { name: "some", totalEarned: "4.0000", totalSales: 1, totalResources: 1 },
  ];
  assert.deepEqual(
    rankLeaderboard(withZero, { sort: "avg_resource" }).map((e) => e.name),
    ["some", "none"]
  );
});

test("avg_sale sinks publishers with no sales to the bottom", () => {
  const withZero = [
    { name: "none", totalEarned: "0.0000", totalSales: 0, totalResources: 2 },
    { name: "some", totalEarned: "4.0000", totalSales: 2, totalResources: 1 },
  ];
  assert.deepEqual(
    rankLeaderboard(withZero, { sort: "avg_sale" }).map((e) => e.name),
    ["some", "none"]
  );
});

test("ranks by verified resource count, earnings breaks ties", () => {
  const trust = [
    { name: "few", totalEarned: "50.0000", totalSales: 9, totalResources: 9, verifiedResources: 1 },
    { name: "lots", totalEarned: "2.0000", totalSales: 1, totalResources: 9, verifiedResources: 8 },
    { name: "mid-rich", totalEarned: "40.0000", totalSales: 5, totalResources: 9, verifiedResources: 4 },
    { name: "mid-poor", totalEarned: "1.0000", totalSales: 1, totalResources: 9, verifiedResources: 4 },
  ];
  assert.deepEqual(
    rankLeaderboard(trust, { sort: "verified" }).map((e) => e.name),
    ["lots", "mid-rich", "mid-poor", "few"]
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

test("offset walks past the first page", () => {
  assert.deepEqual(
    rankLeaderboard(board, { limit: 1, offset: 1 }).map((e) => e.name),
    ["c"]
  );
  // offset without a limit runs to the end of the board
  assert.deepEqual(
    rankLeaderboard(board, { offset: 1 }).map((e) => e.name),
    ["c", "a"]
  );
});

test("offset past the end yields an empty page", () => {
  assert.deepEqual(rankLeaderboard(board, { limit: 5, offset: 10 }), []);
});
