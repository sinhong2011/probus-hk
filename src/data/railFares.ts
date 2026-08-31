import { createSignal } from "solid-js";
import { formatFare } from "~/lib/format";

/**
 * What a train ride costs, which the route database does not know.
 *
 * Every MTR route in `routeFareList` carries `fares: null`, and not by
 * oversight: a bus fare is one number per boarding stop, so it fits beside the
 * stop, while a rail fare exists only between a *pair* of stations - nine
 * thousand of them across the network. The railway publishes that matrix, and
 * `scripts/build-rail-fares.ts` folds it into the file fetched here.
 *
 * It is a quarter of a megabyte, so it is fetched once, on the first ride
 * anyone prices, and never on a page that only asks when the next train is.
 */
const TABLE_URL = "/rail-fares.json";

/** [Octopus adult, single journey, child, elderly, student], in dollars. */
type Row = (number | null)[];

interface Table {
  /** The day the table was built, for the About screen to answer with. */
  generated: string;
  /** Keyed by the two station codes joined - "MOKLCK". */
  fares: Record<string, Row>;
}

export interface RailFare {
  octopus: string | null;
  single: string | null;
  child: string | null;
  elderly: string | null;
  student: string | null;
}

let table: Table | null = null;
let pending: Promise<void> | null = null;

/*
 * The table arrives long after the row that wants it has rendered, and a fare
 * is not worth suspending a page over - the next trains are the thing the rider
 * came for. So the load is a plain fetch and this counter is what makes the
 * fare appear when it lands.
 */
const [loaded, setLoaded] = createSignal(0);

function load() {
  pending ??= fetch(TABLE_URL)
    .then((res) => (res.ok ? (res.json() as Promise<Table>) : null))
    .then((data) => {
      if (data?.fares) table = data;
    })
    // Offline, or the asset is missing: the fare is simply not shown. Nothing
    // else on the page depends on it.
    .catch(() => undefined)
    .finally(() => setLoaded((n) => n + 1));
}

const dollars = (value: number | null | undefined): string | null =>
  value == null ? null : formatFare(String(value));

/**
 * The fare between two stations, or `null` while the table is still coming -
 * and for a pair the railway does not price, which after the Airport Express
 * fares are folded in is no pair the app can offer.
 */
export function railFare(from: string, to: string): RailFare | null {
  loaded();
  if (from === to) return null;
  if (!table) {
    load();
    return null;
  }

  const row = table.fares[from + to];
  if (!row) return null;

  return {
    octopus: dollars(row[0]),
    single: dollars(row[1]),
    child: dollars(row[2]),
    elderly: dollars(row[3]),
    student: dollars(row[4]),
  };
}
