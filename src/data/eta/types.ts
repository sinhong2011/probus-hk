import type { Company, Eta, KeyedRoute } from "~/data/types";

export interface EtaQuery {
  route: KeyedRoute;
  /** Which operator to ask - a joint route can be served by either. */
  co: Company;
  /** 1-based position of the stop along this route's stop list. */
  seq: number;
  /** That operator's own id for the stop. */
  stopId: string;
}

export type EtaFetcher = (q: EtaQuery) => Promise<Eta[]>;
