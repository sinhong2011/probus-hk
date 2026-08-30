import { useQuery } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import { fetchNotices, type Notice } from "./notices";

export interface NoticeBoard {
  /** False when the feed could not be read; the list is then empty. */
  ok: boolean;
  list: Notice[];
}

/**
 * The traffic notices, shared by every screen that shows them.
 *
 * The board and the nearby screen's "affecting your routes" strip used to
 * fetch the feed separately; they are one query now, so opening one after the
 * other costs nothing and they cannot disagree. Notices change on the order of
 * hours, so a fetch is trusted for a while and refreshed when the rider comes
 * back to the tab after that.
 */
export function useNotices(): { notices: Accessor<NoticeBoard>; reload: () => void } {
  const query = useQuery(() => ({
    queryKey: ["notices"] as const,
    queryFn: async (): Promise<NoticeBoard> => {
      try {
        return { ok: true, list: await fetchNotices() };
      } catch {
        return { ok: false, list: [] };
      }
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  }));

  return {
    notices: () => query.data,
    reload: () => void query.refetch(),
  };
}
