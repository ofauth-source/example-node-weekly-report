import { writeFile } from "node:fs/promises";

// Run: node --env-file=.env weekly-report.js 2026-10-05 > weekly-report.json
const startDate = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate ?? "")) {
	throw new Error("Supply a UTC start date: YYYY-MM-DD");
}
const start = new Date(`${startDate}T00:00:00.000Z`);
if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== startDate) {
	throw new Error("Invalid start date");
}
const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
const headers = {
	authorization: `Bearer ${process.env.ACCESS_TOKEN ?? ""}`,
	"x-linked-account-id": process.env.LINKED_ACCOUNT_ID ?? "",
};
if (!process.env.ACCESS_TOKEN || !process.env.LINKED_ACCOUNT_ID) {
	throw new Error("Set ACCESS_TOKEN and LINKED_ACCOUNT_ID");
}
async function read(path, query) {
	const url = new URL(`https://api.ofauth.com/v3/access/${path}`);
	url.search = new URLSearchParams(query).toString();
	const response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(15_000) });
	if (!response.ok) throw new Error(`Finance read failed: ${response.status}`);
	return response.json();
}

const series = await read("finances/earnings/timeseries", {
	startDate: start.toISOString(),
	endDate: new Date(end.getTime() - 1).toISOString(),
	by: "total",
	withTotal: "true",
});
if (!series.total || !Array.isArray(series.total.chartAmount)) {
	throw new Error("Missing total earnings series");
}

const transactions = new Map();
const cursors = new Set();
let cursor;
do {
	// Transactions have no endDate parameter. Filter the upper bound below.
	const query = { startDate: start.toISOString(), limit: "100" };
	if (cursor) query.cursor = cursor;
	const result = await read("finances/earnings/transactions", query);
	for (const item of result.items) {
		const timestamp = Date.parse(item.createdAt);
		if (!Number.isFinite(timestamp)) throw new Error(`Invalid date for ${item.id}`);
		if (timestamp >= start.getTime() && timestamp < end.getTime()) {
			if (item.currency !== "USD") throw new Error(`Unexpected currency: ${item.currency}`);
			transactions.set(item.id, item);
		}
	}
	if (!result.page.hasMore) break;
	cursor = result.page.nextCursor;
	if (!cursor || cursors.has(cursor)) throw new Error("Pagination did not advance");
	cursors.add(cursor);
} while (true);

const fields = ["gross", "fee", "vat", "tax", "net"];
const groups = new Map();
for (const item of transactions.values()) {
	const key = JSON.stringify([item.type, item.status]);
	if (!groups.has(key)) {
		groups.set(key, { type: item.type, status: item.status, count: 0,
			...Object.fromEntries(fields.map((field) => [field, 0])) });
	}
	const group = groups.get(key);
	group.count += 1;
	for (const field of fields) {
		if (!Number.isFinite(item.amounts[field])) throw new Error(`Invalid ${field} for ${item.id}`);
		// Sum integer cents, then convert back to USD major units for output.
		group[field] += Math.round(item.amounts[field] * 100);
	}
}
const byTypeAndStatus = [...groups.values()].map((group) => ({
	...group,
	...Object.fromEntries(fields.map((field) => [field, group[field] / 100])),
})).sort((a, b) => JSON.stringify([a.type, a.status]).localeCompare(JSON.stringify([b.type, b.status])));

const report = {
	window: { startInclusive: start.toISOString(), endExclusive: end.toISOString() },
	currency: "USD",
	transactionCount: transactions.size,
	byTypeAndStatus,
	// Keep the API metric separate from transaction aggregates.
	earnings: {
		reportedTotal: series.total.total,
		amountPoints: series.total.chartAmount.map(({ date, count }) => ({ date, amount: count })),
	},
};
// Retain source records, including IDs, statuses, and nullable users, for review.
await writeFile("weekly-transactions.json", `${JSON.stringify([...transactions.values()], null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
