import * as m from "~/paraglide/messages";
import type { Bilingual } from "~/data/types";

export type Lang = "zh" | "en";

/**
 * UI copy is compiled by Paraglide from messages/{locale}.json into plain
 * functions. Paraglide was chosen over a runtime i18n library because it has no
 * framework coupling at all - the Solid bindings of the alternatives still
 * target Solid 1 and import module paths that Solid 2 removed.
 *
 * The locale is always passed explicitly rather than read from Paraglide own
 * ambient state. That is deliberate: reading the language signal at the call
 * site is what makes a label re-render when the user switches language, with no
 * page reload and no provider component.
 */
type Message = (inputs?: Record<string, never>, options?: { locale?: Lang }) => string;

const MESSAGES = {
  nearby: m.nearby,
  search: m.search,
  searchRoutes: m.search_routes,
  saved: m.saved,
  settings: m.settings,
  pinned: m.pinned,
  nearbyStops: m.nearby_stops,
  routesHere: m.routes_here,
  routes: m.routes,
  towards: m.towards,
  arriving: m.arriving,
  scheduled: m.scheduled,
  noService: m.no_service,
  minute: m.minute,
  live: m.live,
  passed: m.passed,
  youAreHere: m.you_are_here,
  walk: m.walk,
  reverse: m.reverse,
  wholeFare: m.whole_fare,
  holidayFare: m.holiday_fare,
  weekdayFare: m.weekday_fare,
  stops: m.stops,
  aboutMinutes: m.about_minutes,
  language: m.language,
  theme: m.theme,
  themeAuto: m.theme_auto,
  themeLight: m.theme_light,
  themeDark: m.theme_dark,
  refresh: m.refresh,
  radius: m.radius,
  showScheduled: m.show_scheduled,
  reduceMotion: m.reduce_motion,
  offlineData: m.offline_data,
  routeDatabase: m.route_database,
  updateNow: m.update_now,
  downloaded: m.downloaded,
  updatedAt: m.updated_at,
  locating: m.locating,
  locationDenied: m.location_denied,
  locationHint: m.location_hint,
  noResults: m.no_results,
  noNearby: m.no_nearby,
  emptySaved: m.empty_saved,
  emptySavedHint: m.empty_saved_hint,
  loadingData: m.loading_data,
  dataError: m.data_error,
  retry: m.retry,
  dimmedKeys: m.dimmed_keys,
  dataSource: m.data_source,
  joint: m.joint,
  edit: m.edit,
  done: m.done,
  suspended: m.suspended,
  noLiveFeed: m.no_live_feed,
  browseRoutes: m.browse_routes,
  categories: m.categories,
  frequent: m.frequent,
  noFrequent: m.no_frequent,
  noFrequentHint: m.no_frequent_hint,
  searchAnything: m.search_anything,
  fareConcession: m.fare_concession,
  routesCount: m.routes_count,
  firstBus: m.first_bus,
  lastBus: m.last_bus,
  every: m.every,
  stopsMatched: m.stops_matched,
  viewAll: m.view_all,
  fareOctopus: m.fare_octopus,
  fareFull: m.fare_full,
  tapForEta: m.tap_for_eta,
  earlierStops: m.earlier_stops,
  openStop: m.open_stop,
  mapUnavailable: m.map_unavailable,
  plan: m.plan,
  notices: m.notices,
  fromLabel: m.from_label,
  toLabel: m.to_label,
  myLocation: m.my_location,
  chooseDest: m.choose_dest,
  planHint: m.plan_hint,
  direct: m.direct,
  oneChange: m.one_change,
  changeHere: m.change_here,
  wholeJourney: m.whole_journey,
  noJourneys: m.no_journeys,
  noJourneysHint: m.no_journeys_hint,
  noNotices: m.no_notices,
  noNoticesHint: m.no_notices_hint,
  noticesSource: m.notices_source,
  walkLabel: m.walk_label,
  swapEnds: m.swap_ends,
  boardAt: m.board_at,
  alightAt: m.alight_at,
  affectsRoutes: m.affects_routes,
  noticesFailed: m.notices_failed,
  leaveNow: m.leave_now,
  leaveIn: m.leave_in,
  tooLate: m.too_late,
  takeNext: m.take_next,
  timetable: m.timetable,
  daysDaily: m.days_daily,
  daysWeekday: m.days_weekday,
  daysSaturday: m.days_saturday,
  daysSunday: m.days_sunday,
  everyMinutes: m.every_minutes,
  singleDeparture: m.single_departure,
  noTimetable: m.no_timetable,
  routeInfo: m.route_info,
  navigation: m.navigation,
  close: m.close,
  nearestStop: m.nearest_stop,
  chooseOrigin: m.choose_origin,
  mapMyLocation: m.map_my_location,
  mapWholeRoute: m.map_whole_route,
  mapGestureMobile: m.map_gesture_mobile,
  mapGestureDesktop: m.map_gesture_desktop,
  mapGestureMac: m.map_gesture_mac,
  walkMinutes: m.walk_minutes,
  notRunning: m.not_running,
  bookmarkThese: m.bookmark_these,
  addBookmark: m.add_bookmark,
  bookmarked: m.bookmarked,
  noLocation: m.no_location,
} as const satisfies Record<string, Message>;

export type MessageKey = keyof typeof MESSAGES;

export function t(key: MessageKey, lang: Lang): string {
  return MESSAGES[key]({}, { locale: lang });
}

/**
 * Hong Kong transit is read bilingually in practice - a Chinese-first rider
 * still recognises the English name on the bus blind - so most rows show both,
 * and these helpers pick the right half of a value from the route database.
 */
export function pick(value: Bilingual | undefined, lang: Lang): string {
  return value ? value[lang] : "";
}

/**
 * KMB stop names carry a pole code such as "(WT916)". It is useful when you are
 * standing at a stop served by several poles, but it is noise in a dense list.
 */
export function stripStopCode(name: string): string {
  return name.replace(/\s*\([A-Z]{2}\d{3,4}\)\s*$/, "").trim();
}

export function stopCode(name: string): string | null {
  return /\(([A-Z]{2}\d{3,4})\)\s*$/.exec(name)?.[1] ?? null;
}
