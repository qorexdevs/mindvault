// ranking for GET /publishers/leaderboard. earnings is the default board; sales
// and resources let it rank by volume instead of money. earnings is the
// secondary key on every sort so ties land in a stable, sensible order.
export const LEADERBOARD_SORTS = ["earnings", "sales", "resources"] as const;

export type LeaderboardSort = (typeof LEADERBOARD_SORTS)[number];

type RankedEntry = {
  totalEarned: string;
  totalSales: number;
  totalResources: number;
};

export function rankLeaderboard<T extends RankedEntry>(
  entries: T[],
  opts: { sort?: LeaderboardSort; limit?: number } = {}
): T[] {
  const sort = opts.sort ?? "earnings";
  const earned = (e: RankedEntry) => parseFloat(e.totalEarned);
  const sorted = [...entries].sort((a, b) => {
    const primary =
      sort === "sales"
        ? b.totalSales - a.totalSales
        : sort === "resources"
          ? b.totalResources - a.totalResources
          : earned(b) - earned(a);
    return primary !== 0 ? primary : earned(b) - earned(a);
  });
  return opts.limit !== undefined ? sorted.slice(0, opts.limit) : sorted;
}
