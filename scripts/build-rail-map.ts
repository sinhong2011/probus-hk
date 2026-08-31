/**
 * Lays out the schematic railway map.
 *
 * The first version of this relaxed the real coordinates under forces - pull
 * every edge to its nearest compass direction, push stations apart, hold each
 * on a spring to where it truly is - and it does not work. A metro map is a
 * design, not an optimum: every constraint added to such a search is paid for
 * by another, and the versions that scored best looked least like Hong Kong.
 * Opening the harbour cost a fifth of the angles; squaring the runs put
 * stations back on top of each other.
 *
 * So the positions are set by hand, and this does only the part that is not a
 * judgement. Every junction, terminus and shared station is anchored below, as
 * is every station whose place carries a decision - Nathan Road is a straight
 * drop because that is what it is, not because a search found it. The rest are
 * strung along the runs between anchors, which is arithmetic: take an
 * octilinear path and space them evenly along it.
 *
 * A line may also turn *between* two stations. The railway's own map is mostly
 * rows and columns joined by wide curves, and the curve is rarely at a station:
 * the Kwun Tong line leaves Kowloon Bay eastwards and is heading south by the
 * time it reaches Ngau Tau Kok. Drawn only with corners at stations that is a
 * diagonal, and a map of diagonals is a wiring diagram. So a segment between
 * two anchors may carry elbows, set by hand in `BENDS`, and a run whose spaced
 * stations straddle its one corner gets that corner as an elbow automatically.
 *
 * Because the anchors are the input, the failures are legible. A run that
 * cannot be drawn names the two anchors whose relationship is impossible, and
 * that pair is the only thing anyone has to think about.
 *
 *   bun run railmap
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DB_URL = "https://data.hkbus.app/routeFareList.min.json";
const OUT = fileURLToPath(new URL("../src/data/railMap.ts", import.meta.url));

/** The ten heavy-rail lines, in the order the railway's own map lists them. */
const LINE_ORDER = ["TWL", "KTL", "ISL", "TKL", "TCL", "TML", "EAL", "SIL", "DRL", "AEL"];

type Point = [number, number];

/**
 * Hand-set positions, one square per hop, x east and y south.
 *
 * The y axis is banded so the regions cannot collide: the New Territories have
 * 0-20, Kowloon 22-33, the harbour 34-36, Hong Kong Island 37 and below. An
 * earlier layout left Tai Wai two squares from Mong Kok, a ten-kilometre error
 * and the kind the eye catches at a glance. The harbour band is narrow on
 * purpose: it is one crossing, not a region, and drawn any wider the Tsuen Wan
 * line's dive to Admiralty - the shortest of the three tunnels - was the
 * longest stroke on the map, and East Rail could not reach Exhibition Centre
 * on the straight slant the printed map draws it on.
 *
 * The shape follows the railway's own map where it can: East Rail runs the
 * border row along the top and turns down after University onto the spine at
 * x=35; Nathan Road is a pair of parallel verticals at x=30; the Kwun Tong
 * line runs east along a row and turns down a column; the Island line runs
 * the north shore and turns south after Sai Wan Ho; Tseung Kwan O rises from
 * Quarry Bay and turns in to Yau Tong; West Kowloon is a column of its own,
 * Kowloon under Olympic under Nam Cheong. Where the official map bends
 * between stations, `BENDS` does too.
 */
const ANCHORS: Record<string, Point> = {
  // East Rail: the border towns along the top row, the way the railway's own
  // map has them - Lo Wu at the row's west end, Lok Ma Chau on a sub-row
  // below it reaching further west - then a wide curve down after University
  // onto the spine at x=35, past the Racecourse loop and down to Mong Kok
  // East. Hung Hom does not stand on that spine: the railway's own map runs
  // the column a station's width east of it and turns off below Mong Kok
  // East, so the line comes in to Hung Hom on the slant, alongside Tuen Ma.
  // Ho Man Tin sits east of the column and Hung Hom west of it, each about a
  // square off, which is the spacing the printed map gives them. The slant
  // carries on past Hung Hom and across the water to Exhibition Centre, which
  // stands out in it on Hong Kong station's own row, the way the railway's own
  // map levels the pair, and turns in to Admiralty from there.
  LOW: [22, 2],
  SHS: [24, 2],
  LMC: [20, 4],
  UNI: [32, 2],
  FOT: [35, 10],
  TAW: [35, 16],
  KOT: [35, 24],
  MKK: [35, 26],
  HUH: [34, 32],
  // Exhibition Centre stands where the slant out of Hung Hom reaches the
  // water: East Rail leaves Mong Kok East's column, crosses Ho Man Tin's row
  // and runs one unbroken diagonal through Hung Hom and on to the harbour
  // station, which is how the railway's own map draws that whole stretch.
  // Everything else here follows from that line - Wan Chai stands under it,
  // and Admiralty a station west along the shore.
  EXC: [31, 35],

  // Tsuen Wan line: one flat row west, then straight down Nathan Road, which
  // the Kwun Tong line joins at Prince Edward from Shek Kip Mei.
  TSW: [10, 24],
  LAK: [18, 24],
  MEF: [22, 24],
  // Prince Edward stands below the corner, first station on Nathan Road
  // proper, the way the railway's own map has it: the red line turns down
  // after Sham Shui Po, the green after Shek Kip Mei, and the two curves
  // merge above the capsule rather than on it.
  SSP: [28.5, 24],
  PRE: [30, 25.5],
  SKM: [32, 24],
  MOK: [30, 27],
  YMT: [30, 28.5],
  JOR: [30, 30.5],
  TST: [30, 32],

  // Hong Kong Island: one straight rule along the north shore, set a channel
  // south of Kowloon and turning south after Sai Wan Ho the way the shore
  // does. The channel is as wide as the railway's own map makes it and no
  // wider, which is narrower than it once was here: East Rail crosses it on
  // the slant out of Hung Hom and Exhibition Centre stands in it, so it is no
  // longer empty water whose only job is to be read as water.
  //
  // Kennedy Town to Wan Chai is one even row of two-and-a-half squares a
  // station, the spacing the printed map keeps the whole way along the shore.
  // Admiralty used to stand four squares off Central because it was pinned
  // under Nathan Road; it is a station's width from Central on the railway's
  // own map, and the Tsuen Wan line reaches it by stepping west at the end
  // rather than by dropping straight down.
  KET: [16, 37],
  // Central stands directly under Hong Kong station, as the railway's own
  // map stacks the pair, with the walkway a straight vertical between them.
  CEN: [26, 37],
  ADM: [28.5, 37],
  // Wan Chai stands directly under Exhibition Centre, as the railway's own
  // map stacks them - the harbour station and the shore station on one
  // column - and Exhibition Centre in turn stands under East Tsim Sha Tsui,
  // the three of them one column across the water, which is where the
  // printed map puts them and what lets East Rail run in straight.
  WAC: [31, 37],
  NOP: [45, 37],
  QUB: [49, 37],
  SWH: [54, 37],
  SKW: [57, 40],
  CHW: [57, 46],
  OCP: [30, 40],
  WCH: [30, 43],
  LET: [28, 45],
  SOH: [24, 45],

  // Kowloon east: the Kwun Tong row shares the Tsuen Wan line's y=24 - on
  // the railway's own map Tsuen Wan to Sham Shui Po and Shek Kip Mei to Choi
  // Hung stand on one horizontal rule - then turns down a column at x=49 and
  // comes in to Yau Tong; Tuen Ma drops from Diamond Hill down x=41.5 to Kai
  // Tak, then leaves the column on a long 45-degree run down through Sung
  // Wong Toi and To Kwa Wan before it flattens into Ho Man Tin's row - the
  // way the railway's own map draws that stretch, one slant across the old
  // airport rather than a square corner east of the station. Tseung Kwan O
  // sits at the end of the row, and its two branches fan out east of it to
  // one further column - up to Hang Hau and Po Lam, down to LOHAS Park - the
  // way the railway's own map splays them.
  HOM: [36, 30],
  WHA: [38, 31],
  TKW: [39.5, 29],
  SUW: [40.5, 28],
  KAT: [41.5, 25.5],
  DIH: [41.5, 24],
  HIK: [37.5, 16],
  CHH: [44, 24],
  KOB: [46.5, 24],
  NTK: [49, 26],
  LAT: [49, 29],
  YAT: [52, 32],
  TIK: [55, 32],
  TKO: [58, 32],
  POA: [61, 26],
  HAH: [61, 29],
  LHP: [61, 36],

  // Tuen Ma: the long western arm, through west Kowloon, and up the east.
  // The north-west is one narrow U-turn, the way the railway's own map draws
  // it: up out of Tsuen Wan West with the curve bowing west, the column that
  // carries Kam Sheung Road, Yuen Long and Long Ping - west of Tsuen Wan
  // West, as the railway has it - a hairpin over the top at Tin Shui Wai,
  // and down the far column through Siu Hong to Tuen Mun. The light rail
  // sits west of it all, pushed left to give the U its room. Tsuen Wan West
  // stands directly over Tsuen Wan on a parallel row, which the row to Mei
  // Foo leaves eastward. Ma On Shan is a column beside East Rail that turns
  // along the top.
  TUM: [4, 17],
  SIH: [4, 11],
  TIS: [6, 4],
  LOP: [8, 6],
  YUL: [8, 11],
  KSR: [8, 16],
  TWW: [10, 22],
  NAC: [22, 28],
  // Austin stands on the West Kowloon diagonal itself, where the railway's
  // own map has it - the slant runs down from Nam Cheong through the station
  // and only flattens there, into the row that carries it east to East Tsim
  // Sha Tsui. Set a square short of the slant it was a station beside the
  // line rather than on it, and Kowloon, which stands level with it across
  // the walkway, was dragged up with it.
  AUS: [27, 33],
  // East Tsim Sha Tsui stands a square east of Nathan Road and directly over
  // Exhibition Centre, the way the printed map columns the two across the
  // water.
  ETS: [31, 33],
  CKT: [38, 12],
  CIO: [38, 6],
  SHM: [41, 4],
  WKS: [53, 4],

  // Light Rail, one square per hop. Sixty-odd stops in a mesh with almost no
  // straight runs, so nearly all of them are judgements and nearly all are
  // anchored; the ids are the railway's own, canonicalised.

  // The Tin Shui Wai loop, north-west of the Tuen Ma station it feeds -
  // which sits at the crest of the U-turn, so the loop hangs off its side.
  LR435: [6, 3],
  LR450: [5.5, 2.5],
  LR455: [5, 2],
  LR500: [4.5, 1.5],
  LR510: [4, 1],
  LR520: [3.5, 0.5],
  LR530: [2.5, 0.5],
  LR540: [1.5, 0.5],
  LR550: [1, 1],
  LR480: [1, 2],
  LR468: [1.5, 2.5],
  LR490: [2.5, 1.5],
  LR460: [2.5, 2.5],
  LR448: [3.5, 3.5],
  LR445: [5, 5],

  // The trunk down to Siu Hong, and the fork at Hung Shui Kiu.
  LR425: [6, 6],
  LR390: [6, 7],
  LR380: [5.5, 6.5],
  LR370: [5, 7],
  LR360: [5, 8],
  LR350: [5, 10],

  // The Yuen Long arm, hooked down the inside of the Tuen Ma line's U-turn
  // to end at Yuen Long on its east column.
  LR400: [6.5, 7.5],
  LR560: [6.5, 8.5],
  LR570: [6.5, 9.5],
  LR580: [6.5, 10.5],
  LR590: [7, 11],

  // Tuen Mun: the western loop down to the ferry pier, the two columns
  // between Siu Hong and Tuen Mun, and the town centre south of the station.
  LR110: [3, 10],
  LR120: [2, 11],
  LR130: [1, 10],
  LR140: [0, 11],
  LR150: [0, 12],
  LR160: [0, 13],
  LR170: [0, 14],
  LR212: [1, 13],
  LR220: [1, 14],
  LR230: [2, 14],
  LR90: [3, 12],
  LR80: [3, 13],
  LR75: [3, 15],
  LR70: [3, 16],
  LR300: [5, 18],
  LR280: [4, 19],
  LR275: [5, 20],
  LR270: [4, 21],
  LR265: [3, 21],
  LR920: [3, 22],
  LR260: [2, 21],
  LR250: [1, 21],
  LR240: [0, 21],
  LR1: [-1, 21],
  LR10: [-2, 20],
  LR15: [-2, 19],
  LR20: [-2, 18],
  LR30: [-2, 17],
  LR40: [-2, 16],
  LR50: [-2, 15],
  LR200: [0, 15],
  LR60: [0, 17],
  LR180: [1, 15],
  LR190: [1, 16],

  // Lantau, the airport, and the crossing to Hong Kong station. The Airport
  // Express dives off Tsing Yi beside the Tung Chung line's diagonal, runs
  // flat into the airport, and hairpins back up to AsiaWorld-Expo - the
  // railway's own map draws that U-turn, and drawn straight the airport
  // looked like one more station on a row.
  TSY: [10, 32],
  KOW: [22, 33],
  HOK: [26, 35],
  SUN: [6, 36],
  TUC: [2, 40],
  DIS: [8, 38],
  AIR: [2, 37],
  AWE: [3.5, 32.5],
};

/**
 * Where a line turns between two anchored stations: the elbows, in order from
 * the first station named to the second. Each leg has to be octilinear, and
 * the script says so if one is not.
 */
const BENDS: Record<`${string}>${string}`, Point[]> = {
  // Sheung Shui to Lok Ma Chau: the branch dips off the border row and runs
  // west underneath it, reaching further out than Lo Wu does.
  "SHS>LMC": [[22, 4]],
  // The crest of the north-west U-turn, with Tin Shui Wai at its very top,
  // dead centre. Both shoulders step down in 45-degree turns - never 90 -
  // so the rounding chains them into one continuous arch, the way the
  // airport hairpin is drawn, rather than two corners with a lid.
  "SIH>TIS": [
    [4, 5],
    [5, 4],
  ],
  "TIS>LOP": [
    [7, 4],
    [8, 5],
  ],
  // Kam Sheung Road to Tsuen Wan West: down the column past the station,
  // then the curve bows out south-west into the row over Tsuen Wan.
  "KSR>TWW": [[8, 20]],
  // University to Fo Tan: the border row turns down onto the spine, the wide
  // curve the railway's own map draws east of the campus.
  "UNI>FOT": [[35, 2]],
  // Mong Kok East to Hung Hom: the spine runs on past Ho Man Tin's row and
  // only then turns off it, west onto the slant Tuen Ma is already taking
  // into Hung Hom - the two arrive as a pair, which `TOGETHER` in the layout
  // holds apart. Straight down the column instead, the station stood on the
  // spine and East Rail met Tuen Ma at a crossing rather than beside it.
  "MKK>HUH": [[35, 31]],
  // Tai Wai to Che Kung Temple: out on the diagonal, then up the Ma On Shan
  // column for the last square, so the branch arrives at the station pointing
  // north rather than turning on it.
  "TAW>CKT": [[38, 13]],
  // Exhibition Centre to Admiralty: the slant out of Hung Hom runs straight
  // on through the harbour station and only turns at the shore, a half square
  // short of Admiralty, so the whole crossing from Mong Kok East's column to
  // the terminus is one line with one corner in it - which is how the
  // railway's own map draws it. The corner is that close to the station
  // because a longer flat run in would lie along the Island line's own row
  // and hide it; at half a square the curve swallows the straight.
  "EXC>ADM": [[29, 37]],
  // Sai Wan Ho to Shau Kei Wan: the Island line turns south.
  "SWH>SKW": [[57, 37]],
  // Quarry Bay to Yau Tong: straight up out of the harbour in Lam Tin's own
  // column, then a wide sweep east into the junction - the railway's map has
  // the Kwun Tong line curl in from above and this line from below, two
  // nested curves on one column, and the diagonal that used to be here read
  // as a slip road instead.
  "QUB>YAT": [[49, 32]],
  // Lam Tin to Yau Tong: the matching curve from above.
  "LAT>YAT": [[49, 32]],
  // Tseung Kwan O to LOHAS Park: out on the diagonal with its twin to Hang
  // Hau, then a curve onto the branch column so the spur arrives at its
  // terminus pointing south, the way the railway's own map hangs it.
  "LHP>TKO": [[61, 35]],
  // Tsuen Wan West to Mei Foo: along the parallel row over the Tsuen Wan
  // line, then down through Mei Foo's capsule towards Nam Cheong.
  "MEF>TWW": [[22, 22]],
  // Nam Cheong to Austin runs straight down the West Kowloon diagonal now
  // that Austin stands on it, and Austin to East Tsim Sha Tsui straight along
  // the row it turns onto - so neither pair carries an elbow any more. The
  // row is the one Austin shares with Kowloon, which stands level with it on
  // the railway's own map, either side of the high-speed terminus between
  // them.
  //
  // East Tsim Sha Tsui to Hung Hom: east along that row, then onto the slant
  // East Rail is taking up out of the harbour, which the two lines ride into
  // the station together - `TOGETHER` in the layout holds them apart.
  "ETS>HUH": [[33, 33]],
  // Hong Kong to Kowloon: west along the harbour, then one right angle up
  // the West Kowloon column - Olympic and Nam Cheong stacked above - the
  // way the railway's own map turns it, not a diagonal slip across the water.
  "HOK>KOW": [[22, 35]],
  // Tsim Sha Tsui to Admiralty: straight down Nathan Road's column across the
  // water, passing east of Admiralty the way the railway's own map has it,
  // then west along the shore into the station - the last piece riding the
  // Island line's own track, which is what `EXTENDED` is for.
  "TST>ADM": [[30, 37]],
  // Admiralty to Ocean Park: south out of the terminus, then the diagonal
  // that carries the line onto the Wong Chuk Hang column.
  "ADM>OCP": [[28.5, 38.5]],
  // Kowloon Bay to Ngau Tau Kok: the row becomes a column.
  "KOB>NTK": [[49, 24]],
  // Hin Keng to Diamond Hill: down the diagonal as before, then straight on
  // down the Kai Tak column to meet the lowered Kwun Tong row.
  "HIK>DIH": [[41.5, 20]],
  // Sham Shui Po to Prince Edward, and Shek Kip Mei to Prince Edward: both
  // lines turn down into Nathan Road at the same corner, one curve from each
  // side, and run as a pair through the capsule below.
  "SSP>PRE": [[30, 24]],
  "SKM>PRE": [[30, 24]],
  // Yau Ma Tei to Ho Man Tin: the green keeps to Nathan Road past the
  // capsule, and only then peels off east, over East Rail - so the fork sits
  // below the station, not across it. It turns onto Ho Man Tin's own row and
  // holds it all the way in, which is what makes the station read as a stop
  // on the Kwun Tong line with a stub hanging off it: turning a square short
  // and arriving on the slant, the line only crossed Tuen Ma there. The turn
  // is chamfered rather than square because the row runs level with Jordan's
  // own square and a corner set down in it would have stood on the station.
  "YMT>HOM": [
    [30, 29],
    [31, 30],
  ],
  // Ho Man Tin to To Kwa Wan: east along the station's own row, then up onto
  // the slant that carries the line to Sung Wong Toi and on towards Kai Tak.
  "HOM>TKW": [[38.5, 30]],
  // Ho Man Tin to Whampoa: the stub drops clear of Ho Man Tin's row and runs
  // flat into the terminus, so Whampoa stands a little below the junction and
  // two squares east of it - where the railway's own map puts it, well above
  // Hung Hom. Drawn as one long 45-degree run it reached Hung Hom's own row,
  // and a two-station branch read as far the longer journey of the pair. The
  // slant comes first because east out of Ho Man Tin is Tuen Ma's, and two
  // lines leaving one station the same way have nothing to hold them apart.
  "HOM>WHA": [[37, 31]],
  // Sung Wong Toi to Kai Tak: off the slant onto the Kai Tak column, so the
  // line arrives at the station pointing north into Diamond Hill.
  "SUW>KAT": [[41.5, 27]],
  // City One to Shek Mun: the Ma On Shan column becomes the top row.
  "CIO>SHM": [[38, 4]],
  // Kowloon to Tsing Yi: the Express and the Tung Chung line are one physical
  // corridor, and the railway's map draws them as a pair the whole way - the
  // Express simply passes Olympic, Nam Cheong and Lai King without stopping.
  // So it shadows the Tung Chung line's route one square inside it - up the
  // West Kowloon column, over the crest at Lai King, down to Tsing Yi -
  // rather than inventing a straight run across the harbour that no train
  // makes.
  "KOW>TSY": [
    [21, 32],
    [21, 28],
    [17, 24],
    [10, 31],
  ],
  // Tsing Yi to the airport: the Express runs down the Tung Chung line's
  // diagonal a hair to its seaward side - past Sunny Bay, which it passes
  // but does not call at, the way the railway's own map has the pair run
  // together - and only beyond it turns flat towards the airport.
  "TSY>AIR": [
    [9, 32],
    [4, 37],
  ],
  // The airport hairpin: the Express runs through the airport - which sits on
  // the bend itself, as the railway's own map has it - and sweeps all the way
  // round to finish at AsiaWorld-Expo, pointing back north-east towards Sunny
  // Bay. Every corner of the loop turns 45 degrees, never 90: rounded, the
  // steps chain into one continuous curve instead of a flat-bottomed box.
  "AIR>AWE": [
    [1, 36],
    [1, 35],
  ],
  // Sunny Bay to Disneyland: the spur leaves the junction and swings round
  // into the resort from the north, one quarter-circle of 45-degree steps -
  // drawn straight it was a slip road, not the little branch it is.
  "DIS>SUN": [
    [8, 37],
    [7, 36],
  ],
};

/**
 * The light rail as the railway's own map draws it when it is not the subject:
 * a few loops in its colour, no stops, hung off the Tuen Ma stations it feeds.
 * The diagram shows this until the rider zooms into the network, when the
 * sixty-eight stops take over. Each shape is a polyline in grid squares that
 * begins and ends at a station, so a loop closes under the station's marker
 * rather than turning a rounded corner there and standing off it.
 */
const LIGHT_RAIL_SHAPE: Point[][] = [
  // Tin Shui Wai: a squat loop tucked north-west of the station at the
  // crest, the way the railway's own map coils it beside the capsule.
  [
    [6, 4],
    [6, 3],
    [3.5, 0.5],
    [1.5, 0.5],
    [1, 1],
    [1, 2],
    [1.5, 2.5],
    [2.5, 2.5],
    [5, 5],
    [6, 4],
  ],
  // The Yuen Long arm, dropping inside the Tuen Ma U from Tin Shui Wai and
  // turning in to Yuen Long at its own level.
  [
    [6, 6],
    [6.5, 6.5],
    [6.5, 10.5],
    [7, 11],
    [8, 11],
  ],
  // The trunk beside the Tuen Ma line, Tin Shui Wai down to Tuen Mun.
  [
    [6, 4],
    [6, 6],
    [5, 7],
    [5, 10],
    [4, 11],
    [5, 12],
    [5, 16],
    [4, 17],
  ],
  // Tuen Mun: the loop west of the trunk, and the town south of the station.
  [
    [4, 11],
    [0, 11],
    [0, 17],
    [4, 17],
  ],
  [
    [4, 17],
    [4, 21],
    [-2, 21],
    [-2, 15],
    [0, 15],
    [0, 17],
  ],
];

/**
 * The Racecourse spur, which the route database does not know: no timetabled
 * service calls there - trains run round it on race days only - so it can
 * never fall out of the stop sequences the way every other station does. The
 * railway's map still draws it, dotted, as a bulge off East Rail that leaves
 * the line above Fo Tan and rejoins below it, and a rider who knows the
 * network would miss it. So it is drawn the same way here: a dashed arc in
 * East Rail's colour with one marker on it, decoration rather than a station,
 * because a station with no data behind it would be a button that does
 * nothing.
 *
 * The arc is a half-circle struck from Fo Tan itself, so the bulge is the
 * station's own radius and the marker lands level with it on the due-east
 * point. Drawn as a flat-sided box beside the line instead, the two names sat
 * at different heights and the shape read as a siding rather than the loop it
 * is. Fo Tan sits where it does to give the arc its room: an even three
 * squares to Sha Tin, where it used to stand two, which left no space for a
 * foot to touch down clear of the next station's marker.
 */
const RACECOURSE_R = 1.5;
const RACECOURSE_CENTRE: Point = ANCHORS.FOT!;
const RACECOURSE: Point = [RACECOURSE_CENTRE[0] + RACECOURSE_R, RACECOURSE_CENTRE[1]];
/** Where the arc touches back down on the spine, above Fo Tan and below it. */
const RACECOURSE_FEET: Point[] = [
  [RACECOURSE_CENTRE[0], RACECOURSE_CENTRE[1] - RACECOURSE_R],
  [RACECOURSE_CENTRE[0], RACECOURSE_CENTRE[1] + RACECOURSE_R],
];

/** Nothing may sit closer than this to anything else, in squares. */
const CLEARANCE = 1.4;
/**
 * Except light rail, which is drawn at one hop per square rather than two: it
 * is a tram network, sixty-eight stops in the space the heavy rail gives to
 * fifteen, and spacing it like a railway would make it a third of the map.
 */
const LIGHT_RAIL_CLEARANCE = 0.7;
/**
 * Nor this close to a station on another landmass: that gap is water.
 *
 * Two squares, which is what the railway's own map leaves between East Tsim
 * Sha Tsui and Exhibition Centre - the narrowest the harbour gets on it. It
 * used to be three and a half here, from when the channel was empty and its
 * whole job was to be read as water; now East Rail crosses it on the slant
 * and a station stands in it, and holding the old figure would have pushed
 * the shore so far south that the crossing could not stay straight.
 */
const CHANNEL = 2;
/** An elbow this close to a station that is not one of its own ends is on it. */
const ELBOW_CLEARANCE = 1;

interface Stop {
  location: { lat: number; lng: number };
  name: { en: string; zh: string };
}
interface Route {
  route: string;
  co: string[];
  stops: Record<string, string[]>;
}
type Land = "lantau" | "island" | "mainland";

type Db = { routeList: Record<string, Route>; stopList: Record<string, Stop> };

/* `DB_FILE=path` reads a saved copy: the layout is iterated dozens of times in
   a sitting, and eight megabytes a run is the difference between a tool and a
   chore. */
async function loadDb(): Promise<Db> {
  if (process.env.DB_FILE) return JSON.parse(readFileSync(process.env.DB_FILE, "utf8")) as Db;
  const res = await fetch(DB_URL);
  if (!res.ok) throw new Error(`${DB_URL} answered ${res.status}`);
  return (await res.json()) as Db;
}

const db = await loadDb();

/*
 * Topology, from the stop sequences. A line is several routes - two directions,
 * and more where it branches - so the edges are the union of every consecutive
 * pair across all of them, taken undirected. That picks up the Lo Wu and Lok Ma
 * Chau branches and the LOHAS Park spur without naming them.
 */
const edges = new Map<string, { a: string; b: string; line: string }>();
const onLine = new Map<string, Set<string>>();
const stations = new Set<string>();
/** Light rail route numbers calling at each station, by station id. */
const lightRailAt = new Map<string, Set<string>>();

/*
 * Light Rail is one network on the map, not twenty-seven routes: drawn a route
 * at a time it is twenty-seven overlapping strokes in twelve colours, and the
 * printed map does not do that either. Its edges are the union of every route's
 * consecutive pairs, under one line code, and each station remembers which
 * routes call so the panel can still list them.
 *
 * Two quirks of the data are absorbed here. The same platform appears both as
 * "LR60" and "LR060" depending on which route's stop list you read, so ids are
 * canonicalised. And where a light rail stop and a Tuen Ma station share a
 * name they are one interchange on the ground, and the map shows them as one -
 * the stop is folded into the station, which then carries both.
 */
const LIGHT_RAIL = "LR";
const canonical = (id: string) => id.replace(/^LR0+(?=\d)/, "LR");
const FOLDED: Record<string, string> = { LR295: "TUM", LR100: "SIH", LR430: "TIS", LR600: "YUL" };
const lightRailId = (id: string) => FOLDED[canonical(id)] ?? canonical(id);

for (const key in db.routeList) {
  const route = db.routeList[key];
  const co = route?.co[0];
  if (co !== "mtr" && co !== "lightRail") continue;
  const line = co === "mtr" ? route.route : LIGHT_RAIL;
  const seq = (co === "mtr" ? (route.stops.mtr ?? []) : (route.stops.lightRail ?? [])).map((id) =>
    co === "mtr" ? id : lightRailId(id),
  );
  const members = onLine.get(line) ?? new Set<string>();

  for (let i = 0; i < seq.length; i++) {
    const id = seq[i]!;
    if (!db.stopList[id]) continue;
    stations.add(id);
    members.add(id);
    if (co === "lightRail") {
      const routes = lightRailAt.get(id) ?? new Set<string>();
      routes.add(route.route);
      lightRailAt.set(id, routes);
    }
    const next = seq[i + 1];
    if (!next || !db.stopList[next] || next === id) continue;
    const [a, b] = id < next ? [id, next] : [next, id];
    edges.set(`${line}:${a}:${b}`, { a, b, line });
  }
  onLine.set(line, members);
}

for (const [from, to] of Object.entries(FOLDED)) {
  if (!stations.has(to)) throw new Error(`${from} folds into ${to}, which is not on the map`);
}

const edgeList = [...edges.values()];
const neighbours = new Map<string, Set<string>>();
const linesAt = new Map<string, Set<string>>();
for (const e of edgeList) {
  for (const [x, y] of [
    [e.a, e.b],
    [e.b, e.a],
  ] as const) {
    if (!neighbours.has(x)) neighbours.set(x, new Set());
    if (!linesAt.has(x)) linesAt.set(x, new Set());
    neighbours.get(x)!.add(y);
    linesAt.get(x)!.add(e.line);
  }
}

/*
 * Which landmass a station stands on. The diagram's own coordinates cannot say,
 * having been bent off geography on purpose, but latitude and longitude still
 * can. Lantau is the corner that is both west and south: longitude alone put
 * Yuen Long and Tuen Mun on it, the north-west New Territories reaching further
 * west than the island does.
 */
const landOf = (id: string): Land => {
  const { lat, lng } = db.stopList[id]!.location;
  if (lng < 114.05 && lat < 22.34) return "lantau";
  return lat < 22.292 ? "island" : "mainland";
};

/** Anchored, or a junction, terminus or shared station: anything fixed. */
const isAnchor = (id: string) =>
  id in ANCHORS || (neighbours.get(id)?.size ?? 0) !== 2 || (linesAt.get(id)?.size ?? 0) > 1;

/** Every stretch between two anchors, as [anchor, ...between, anchor]. */
function runs(): string[][] {
  const found: string[][] = [];
  const walked = new Set<string>();
  const key = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

  for (const start of [...stations].sort()) {
    if (!isAnchor(start)) continue;
    for (const first of [...(neighbours.get(start) ?? [])].sort()) {
      if (walked.has(key(start, first))) continue;
      walked.add(key(start, first));
      const chain = [start, first];
      let previous = start;
      let at = first;
      while (!isAnchor(at)) {
        const next = [...neighbours.get(at)!].find((n) => n !== previous)!;
        walked.add(key(at, next));
        chain.push(next);
        previous = at;
        at = next;
      }
      found.push(chain);
    }
  }
  return found;
}

const octilinear = (a: Point, b: Point) => {
  const dx = Math.abs(b[0] - a[0]);
  const dy = Math.abs(b[1] - a[1]);
  return dx === 0 || dy === 0 || dx === dy;
};

/** Octilinear ways from a to b: straight if it can be, else with one bend. */
function paths(a: Point, b: Point): Point[][] {
  if (octilinear(a, b)) return [[a, b]];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const slant = Math.min(Math.abs(dx), Math.abs(dy));
  const straight = Math.abs(Math.abs(dx) - Math.abs(dy));

  // The bend is where the square leg meets the diagonal one, either order.
  return Math.abs(dx) > Math.abs(dy)
    ? [
        [a, [a[0] + sx * straight, a[1]], b],
        [a, [a[0] + sx * slant, a[1] + sy * slant], b],
      ]
    : [
        [a, [a[0], a[1] + sy * straight], b],
        [a, [a[0] + sx * slant, a[1] + sy * slant], b],
      ];
}

/** `count` points spaced evenly along a polyline, excluding its ends. */
function spaceAlong(path: Point[], count: number): Point[] {
  const legs = path.slice(0, -1).map((p, i) => [p, path[i + 1]!] as const);
  const lengths = legs.map(([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]));
  const total = lengths.reduce((sum, l) => sum + l, 0);

  return Array.from({ length: count }, (_, i) => {
    let want = (total * (i + 1)) / (count + 1);
    for (let j = 0; j < legs.length; j++) {
      const [from, to] = legs[j]!;
      const length = lengths[j]!;
      if (want <= length) {
        const t = length === 0 ? 0 : want / length;
        const half = (v: number) => Math.round(v * 2) / 2;
        return [
          half(from[0] + (to[0] - from[0]) * t),
          half(from[1] + (to[1] - from[1]) * t),
        ] as Point;
      }
      want -= length;
    }
    return path[path.length - 1]!;
  });
}

const at = new Map<string, Point>(Object.entries(ANCHORS));
/** Elbows on a segment, keyed by its two stations in id order, in that order. */
const bends = new Map<string, Point[]>();
const failures: string[] = [];

const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);
const setBend = (from: string, to: string, points: Point[]) =>
  bends.set(pairKey(from, to), from < to ? points : [...points].reverse());

for (const [key, points] of Object.entries(BENDS)) {
  const [from, to] = key.split(">") as [string, string];
  if (!stations.has(from) || !stations.has(to))
    failures.push(`bend ${key} names a station not on the map`);
  else if (!neighbours.get(from)?.has(to))
    failures.push(`bend ${key} is not a segment of any line`);
  else setBend(from, to, points);
}

/**
 * Where the one corner of a path falls between two consecutive stations, that
 * corner is an elbow on their segment. Answers the elbow, or null where the
 * pair is straight, or false where not even the corner makes it drawable.
 */
function elbowBetween(path: Point[], a: Point, b: Point): Point | null | false {
  if (octilinear(a, b)) return null;
  const corner = path[1];
  if (path.length !== 3 || !corner) return false;
  return octilinear(a, corner) && octilinear(corner, b) ? corner : false;
}

for (const chain of runs()) {
  const first = chain[0]!;
  const last = chain[chain.length - 1]!;
  const head = at.get(first);
  const tail = at.get(last);
  if (!head || !tail) {
    failures.push(`unanchored end on ${first}..${last}`);
    continue;
  }

  const between = chain.slice(1, -1);
  if (between.length === 0) {
    const via = bends.get(pairKey(first, last)) ?? [];
    const all = [head, ...via, tail];
    if (!all.every((p, i) => i === 0 || octilinear(all[i - 1]!, p)))
      failures.push(`${first}[${head}] - ${last}[${tail}] is off the grid`);
    continue;
  }

  /*
   * Every candidate path is tried and the one that needs the fewest elbows
   * wins: stations that land on the corner themselves draw as a corner at a
   * station, which is what a printed map does where it can.
   */
  const placed = paths(head, tail)
    .map((path) => {
      const points = spaceAlong(path, between.length);
      const all = [head, ...points, tail];
      const elbows: (Point | null)[] = [];
      for (let i = 1; i < all.length; i++) {
        const elbow = elbowBetween(path, all[i - 1]!, all[i]!);
        if (elbow === false) return null;
        elbows.push(elbow);
      }
      return { points, elbows };
    })
    .filter((candidate) => candidate !== null)
    .sort((p, q) => p.elbows.filter(Boolean).length - q.elbows.filter(Boolean).length)[0];

  if (!placed) {
    failures.push(
      `no octilinear route: ${first}[${head}] -> ${last}[${tail}] with ${between.length} between`,
    );
    continue;
  }
  between.forEach((id, i) => at.set(id, placed.points[i]!));
  placed.elbows.forEach((elbow, i) => {
    if (elbow) setBend(chain[i]!, chain[i + 1]!, [elbow]);
  });
}

/* Every rule the drawing depends on, checked here as well as in the unit test:
   a fault should name itself while the layout is still in front of you. */
for (const e of edgeList) {
  const a = at.get(e.a);
  const b = at.get(e.b);
  if (!a || !b) continue;
  const all = [a, ...(bends.get(pairKey(e.a, e.b)) ?? []), b];
  for (let i = 1; i < all.length; i++) {
    if (!octilinear(all[i - 1]!, all[i]!))
      failures.push(`bent ${e.line} ${e.a}[${a}] - ${e.b}[${b}] at ${all[i - 1]} - ${all[i]}`);
  }
}

const ids = [...stations].sort();
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    const a = at.get(ids[i]!);
    const b = at.get(ids[j]!);
    if (!a || !b) continue;
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const light = onLine.get(LIGHT_RAIL)?.has(ids[i]!) || onLine.get(LIGHT_RAIL)?.has(ids[j]!);
    const need = light ? LIGHT_RAIL_CLEARANCE : CLEARANCE;
    if (d < need) failures.push(`${ids[i]} and ${ids[j]} are only ${d.toFixed(2)} apart`);
    else if (landOf(ids[i]!) !== landOf(ids[j]!) && d < CHANNEL) {
      failures.push(`${ids[i]} and ${ids[j]} leave only ${d.toFixed(2)} of water`);
    }
  }
}

for (const [key, points] of bends) {
  const [from, to] = key.split(":");
  for (const elbow of points) {
    for (const id of ids) {
      if (id === from || id === to) continue;
      const p = at.get(id);
      if (p && Math.hypot(p[0] - elbow[0], p[1] - elbow[1]) < ELBOW_CLEARANCE)
        failures.push(`elbow ${elbow} on ${from}-${to} sits on ${id}`);
    }
  }
}

for (const shape of LIGHT_RAIL_SHAPE) {
  for (let i = 1; i < shape.length; i++) {
    if (!octilinear(shape[i - 1]!, shape[i]!))
      failures.push(`light rail shape leg ${shape[i - 1]} - ${shape[i]} is off the grid`);
  }
}

/*
 * The arc has to clear everything but the station it is struck from. Its two
 * feet land on the spine, so they are held to an elbow's clearance - they are
 * track rejoining track - while the marker and the bulge itself are held to a
 * station's, being things a rider reads.
 */
for (const [id, p] of at) {
  if (id === "FOT") continue;
  const toCentre = Math.hypot(p[0] - RACECOURSE_CENTRE[0], p[1] - RACECOURSE_CENTRE[1]);
  if (p[0] >= RACECOURSE_CENTRE[0] && Math.abs(toCentre - RACECOURSE_R) < CLEARANCE)
    failures.push(`the racecourse arc passes within ${CLEARANCE} of ${id}[${p}]`);
  if (Math.hypot(p[0] - RACECOURSE[0], p[1] - RACECOURSE[1]) < CLEARANCE)
    failures.push(`the racecourse marker ${RACECOURSE} sits on ${id}[${p}]`);
  for (const foot of RACECOURSE_FEET)
    if (Math.hypot(p[0] - foot[0], p[1] - foot[1]) < ELBOW_CLEARANCE)
      failures.push(`the racecourse arc touches down on ${id}[${p}]`);
}

const never = ids.filter((id) => !at.has(id));
if (never.length > 0) failures.push(`never placed: ${never.join(", ")}`);

if (failures.length > 0) {
  console.error(`railMap: ${failures.length} problems\n  ${failures.join("\n  ")}`);
  process.exit(1);
}

const ORDER = [...LINE_ORDER, LIGHT_RAIL];

const placed = ids.map((id) => ({
  id,
  x: at.get(id)![0],
  y: at.get(id)![1],
  land: landOf(id),
  lines: ORDER.filter((code) => onLine.get(code)?.has(id)),
  routes: [...(lightRailAt.get(id) ?? [])].sort((p, q) =>
    p.localeCompare(q, undefined, { numeric: true }),
  ),
  // The stop the light rail itself knows this place as: its own id, or for a
  // folded interchange the stop that was folded into the station.
  lightRail: lightRailAt.has(id)
    ? (Object.entries(FOLDED).find(([, to]) => to === id)?.[0] ?? id)
    : undefined,
}));

const lines = ORDER.filter((code) => onLine.has(code)).map((code) => ({
  code,
  edges: edgeList.filter((e) => e.line === code).map((e) => [e.a, e.b] as const),
}));

const point = (p: Point) => `[${p[0]}, ${p[1]}]`;

/*
 * Emitted as source rather than JSON in public/, because a typed module is what
 * survives being read: the editor knows the shape and a diff of one station is
 * one line. It carries geometry and topology only - names and colours already
 * exist in the route database and in `plateStyle`, and a second copy of either
 * would only go stale.
 */
const ts =
  `/**\n` +
  ` * Where each station sits on the schematic map, and what connects to what.\n` +
  ` *\n` +
  ` * Generated by \`bun run railmap\` from the anchors hand-set in that script.\n` +
  ` * Coordinates are grid squares, x rightwards and y down; the renderer scales\n` +
  ` * them. To move a station, move it *there* rather than here - an edit to this\n` +
  ` * file is overwritten the next time anyone runs the script, and the script is\n` +
  ` * also what checks the move has not bent the segments either side of it or\n` +
  ` * slid it on top of a neighbour.\n` +
  ` *\n` +
  ` * Generated ${new Date().toISOString().slice(0, 10)}.\n` +
  ` */\n\n` +
  `export type Land = "lantau" | "island" | "mainland";\n\n` +
  `/** The one line code that is not a railway line: the whole light rail network. */\n` +
  `export const LIGHT_RAIL = "${LIGHT_RAIL}";\n\n` +
  `export interface MapStation {\n` +
  `  /** Station code, the same id the route database uses. */\n` +
  `  id: string;\n` +
  `  x: number;\n` +
  `  y: number;\n` +
  `  /** Which landmass it stands on. */\n` +
  `  land: Land;\n` +
  `  /** Lines calling here, in the railway's own map order; \`LIGHT_RAIL\` last. */\n` +
  `  lines: string[];\n` +
  `  /** Light rail routes calling here, by number. Empty where none do. */\n` +
  `  routes: string[];\n` +
  `  /** The light rail's own id for this place, where its routes call. */\n` +
  `  lightRail?: string;\n` +
  `}\n\n` +
  `/** One grid square, in the units the coordinates below are given in. */\n` +
  `export const GRID = 1;\n\n` +
  `export const MAP_STATIONS: MapStation[] = [\n` +
  placed
    .map(
      (s) =>
        `  { id: "${s.id}", x: ${s.x}, y: ${s.y}, land: "${s.land}", ` +
        `lines: [${s.lines.map((l) => `"${l}"`).join(", ")}], ` +
        `routes: [${s.routes.map((r) => `"${r}"`).join(", ")}]` +
        (s.lightRail ? `, lightRail: "${s.lightRail}"` : "") +
        ` },`,
    )
    .join("\n") +
  `\n];\n\n` +
  `/**\n` +
  ` * The segments of each line, undirected. Branches need no special case: they\n` +
  ` * are simply a station with three neighbours instead of two.\n` +
  ` */\n` +
  `export const MAP_EDGES: Record<string, [string, string][]> = {\n` +
  lines
    .map(
      (l) =>
        `  ${l.code}: [\n` + l.edges.map(([a, b]) => `    ["${a}", "${b}"],`).join("\n") + `\n  ],`,
    )
    .join("\n") +
  `\n};\n\n` +
  `/**\n` +
  ` * Where a segment turns between its two stations: the elbows, keyed by the\n` +
  ` * stations in id order and listed in that order. A segment not here is\n` +
  ` * straight. Every line through the pair shares the same elbows.\n` +
  ` */\n` +
  `export const MAP_BENDS: Record<string, [number, number][]> = {\n` +
  [...bends.entries()]
    .sort(([p], [q]) => (p < q ? -1 : 1))
    .map(([key, points]) => `  "${key}": [${points.map(point).join(", ")}],`)
    .join("\n") +
  `\n};\n\n` +
  `/**\n` +
  ` * The light rail reduced to its shape, for the zooms at which its stops are\n` +
  ` * not drawn: a few loops off the Tuen Ma stations it feeds, the way the\n` +
  ` * railway's own map draws it. Each begins and ends at a station.\n` +
  ` */\n` +
  `export const LIGHT_RAIL_SHAPE: [number, number][][] = [\n` +
  LIGHT_RAIL_SHAPE.map((shape) => `  [${shape.map(point).join(", ")}],`).join("\n") +
  `\n];\n\n` +
  `/**\n` +
  ` * The Racecourse spur, dashed off East Rail as a half-circle struck from\n` +
  ` * Fo Tan - centre, radius, and the arc running east from the spine above\n` +
  ` * the station round to the spine below it.\n` +
  ` * Decoration, not a station: no timetabled service calls there - trains\n` +
  ` * run round it on race days only - so the route database has nothing to\n` +
  ` * say about it, and a marker with no data behind it cannot be a button.\n` +
  ` */\n` +
  `export const RACECOURSE_ARC = { x: ${RACECOURSE_CENTRE[0]}, y: ${RACECOURSE_CENTRE[1]}, r: ${RACECOURSE_R} };\n\n` +
  `/** Where the Racecourse marker and its name sit: due east, level with Fo Tan. */\n` +
  `export const RACECOURSE: [number, number] = ${point(RACECOURSE)};\n`;

writeFileSync(OUT, ts);

const anchored = Object.keys(ANCHORS).length;
console.log(
  `railMap.ts: ${placed.length} stations, ${edgeList.length} edges, ${lines.length} lines\n` +
    `  ${anchored} anchored by hand, ${placed.length - anchored} routed between them, ` +
    `${bends.size} segments with elbows\n` +
    `  every segment on the grid, nothing closer than ${CLEARANCE} squares ` +
    `(${LIGHT_RAIL_CLEARANCE} around light rail)`,
);
