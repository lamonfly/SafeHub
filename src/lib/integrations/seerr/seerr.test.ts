import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { json, migratedDb, startHttp } from "../../../../tests/support/helpers";

const decisions: string[] = [];
let pending = [
  {
    id: 7,
    type: "movie",
    createdAt: "2026-11-15T10:00:00.000Z",
    media: { tmdbId: 603 },
    requestedBy: { displayName: "Sam" },
  },
  {
    id: 8,
    type: "tv",
    createdAt: "2026-11-15T11:00:00.000Z",
    is4k: true,
    media: { tmdbId: 1399 },
    requestedBy: null,
    seasons: [{ seasonNumber: 2 }, { seasonNumber: 1 }],
  },
];
let server: Awaited<ReturnType<typeof startHttp>>;
let seerr: typeof import(".");

beforeAll(async () => {
  server = await startHttp((request, _body, response) => {
    const url = request.url!;
    if (url.startsWith("/api/v1/request?filter=pending")) return json(response, { pageInfo: {}, results: pending });
    if (url === "/api/v1/movie/603") return json(response, { title: "The Matrix", releaseDate: "1999-03-31" });
    if (url === "/api/v1/tv/1399") return json(response, { name: "Game of Thrones", firstAirDate: "2011-04-17" });
    const decision = url.match(/^\/api\/v1\/request\/(\d+)\/(approve|decline)$/);
    if (decision && request.method === "POST") {
      decisions.push(`${decision[2]} ${decision[1]}`);
      pending = pending.filter((item) => item.id !== Number(decision[1]));
      return json(response, { id: Number(decision[1]) });
    }
    return json(response, { message: "not found" }, 404, "Not Found");
  });
  process.env.SEERR_URL = server.url;
  process.env.SEERR_API_KEY = "k";
  await migratedDb();
  seerr = await import(".");
});
afterAll(() => server.close());

describe("Seerr requests", () => {
  it("lists pending requests with titles, years and seasons", async () => {
    expect(await seerr.getSeerrPendingRequests()).toEqual({
      status: "ok",
      data: [
        { id: 7, type: "movie", title: "The Matrix", year: "1999", requestedBy: "Sam", createdAt: "2026-11-15T10:00:00.000Z", is4k: false, seasons: [] },
        { id: 8, type: "tv", title: "Game of Thrones", year: "2011", requestedBy: undefined, createdAt: "2026-11-15T11:00:00.000Z", is4k: true, seasons: [2, 1] },
      ],
    });
  });

  it("approves a request and no longer lists it (no stale cache)", async () => {
    expect(await seerr.decideSeerrRequest({ id: 7, decision: "approve" })).toEqual({ status: "ok", data: undefined });
    expect(decisions).toEqual(["approve 7"]);
    const after = await seerr.getSeerrPendingRequests();
    expect(after.status === "ok" && after.data.map((item) => item.id)).toEqual([8]);
  });

  it("only accepts positive ids and known decisions", () => {
    expect(seerr.requestDecisionSchema.safeParse({ id: 8, decision: "decline" }).success).toBe(true);
    expect(seerr.requestDecisionSchema.safeParse({ id: -1, decision: "approve" }).success).toBe(false);
    expect(seerr.requestDecisionSchema.safeParse({ id: 8, decision: "delete" }).success).toBe(false);
  });
});
