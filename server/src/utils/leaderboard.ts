// ranking for GET /publishers/leaderboard. earnings is the default board; sales
// and resources rank by volume instead of money, avg_sale by revenue per sale
// (earners of premium content over high-volume cheap ones), avg_resource by
// revenue per resource (a lean catalog that earns over a sprawling one that
// barely does). earnings is the secondary key on every sort so ties land in a
// stable, sensible order.
export const LEADERBOARD_SORTS = ["earnings", "sales", "resources", "avg_sale", "avg_resource"] as const;

export type LeaderboardSort = (typeof LEADERBOARD_SORTS)[number];

type RankedEntry = {
  totalEarned: string;
  totalSales: number;
  totalResources: number;
};

export function rankLeaderboard<T extends RankedEntry>(
  entries: T[],
  opts: { sort?: LeaderboardSort; limit?: number; offset?: number } = {}
): T[] {
  const sort = opts.sort ?? "earnings";
  const earned = (e: RankedEntry) => parseFloat(e.totalEarned);
  // revenue per sale; a publisher with no sales averages 0 and sinks to the bottom
  const avgSale = (e: RankedEntry) => (e.totalSales > 0 ? earned(e) / e.totalSales : 0);
  // revenue per resource; a publisher with no resources averages 0 and sinks too
  const avgResource = (e: RankedEntry) => (e.totalResources > 0 ? earned(e) / e.totalResources : 0);
  const sorted = [...entries].sort((a, b) => {
    const primary =
      sort === "sales"
        ? b.totalSales - a.totalSales
        : sort === "resources"
          ? b.totalResources - a.totalResources
          : sort === "avg_sale"
            ? avgSale(b) - avgSale(a)
            : sort === "avg_resource"
              ? avgResource(b) - avgResource(a)
              : earned(b) - earned(a);
    return primary !== 0 ? primary : earned(b) - earned(a);
  });
  const start = opts.offset ?? 0;
  const end = opts.limit !== undefined ? start + opts.limit : undefined;
  return start === 0 && end === undefined ? sorted : sorted.slice(start, end);
}
