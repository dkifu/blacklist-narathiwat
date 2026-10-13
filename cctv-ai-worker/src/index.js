
/*
 CCTV AI ANALYSIS V12.5
 Production Stability / Normal Scene Reporting
 Cloudflare Workers AI — Gemma 4

 Replace: cctv-ai-worker/index.js

 - Single AI invocation
 - Normal and abnormal reporting
 - Evidence-based severity
 - Motorcycle posture verification
 - Rain and wet road separation
 - Per-camera inspection
 - Complete sections 1–5
 - Compatible with existing React report
*/

const MODEL = '@cf/google/gemma-4-26b-a4b-it';

const COUNTS = [4, 6, 9, 12, 16];

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_CHARS = 4200000;
const MAX_OUTPUT_TOKENS = 2450;

const RANK = {
  neutral: -1,
  green: 0,
  yellow: 1,
  orange: 2,
  red: 3,
};

const LEVELS = Object.keys(RANK);

const THAI = {
  neutral: 'ไม่สามารถประเมินได้',
  green: 'ปกติ',
  yellow: 'เฝ้าระวัง',
  orange: 'ผิดปกติ',
  red: 'ฉุกเฉิน',
};

const DOMAINS = [
  'traffic',
  'weather',
  'disaster',
  'accident',
  'crowd',
  'object',
];

const KEYS = [
  'safety',
  'traffic',
  'abnormal',
  'visibility',
];

const EVENTS = [
  ...DOMAINS,
  'flood',
  'other',
];

const TOPICS = [
  'motorcycle',
  'accident',
  'cones',
  'barrier',
  'roadwork',
  'road_obstruction',
  'road_activity',
  'crowd',
  'flood',
  'flood_buildings',
  'flood_road',
  'rain',
  'wet_road',
  'weather',
  'trash_bin',
  'trash_bag',
  'garbage',
  'large_bag',
  'gas_cylinder',
  'fire_extinguisher',
  'object',
  'traffic_flow',
  'normal_traffic',
  'normal_scene',
  'other',
];

const OBJECT_TYPES = [
  'trash_bin',
  'trash_bag',
  'box',
  'crate',
  'sack',
  'large_bag',
  'gas_cylinder',
  'fire_extinguisher',
  'barrel',
  'traffic_cone',
  'container',
  'other',
];

const OBJECT_STATUSES = [
  'ordinary',
  'watch',
  'blocking',
  'immediate_danger',
  'uncertain',
];

const OBJECT_RANKS = {
  ordinary: 'green',
  watch: 'yellow',
  blocking: 'orange',
  immediate_danger: 'red',
  uncertain: 'neutral',
};

const PRECIP = [
  'none',
  'rain_visible',
  'heavy_rain_visible',
  'wet_surface_only',
  'uncertain',
];

const POSTURES = [
  'upright',
  'parked_on_stand',
  'fallen_on_side',
  'uncertain',
];

const FALL_EVIDENCE = [
  'side_and_handlebar_ground',
  'side_and_wheels_horizontal',
  'leaning_only',
  'uncertain',
];

/* =========================================
   CAMERA OBSERVATION RULES
========================================= */

const CUES = {
  motorcycle_fallen: {
    topic: 'motorcycle',
    domain: 'accident',
    level: 'orange',
    priority: 100,

    fact: n =>
      `พบรถจักรยานยนต์นอนตะแคงสัมผัสพื้นในมุมมองที่ ${n} ยังไม่ทราบสาเหตุจากภาพนิ่ง`,

    follow: n =>
      `ควรตรวจสอบรถจักรยานยนต์ลักษณะล้มในมุมมองที่ ${n} เพื่อยืนยันสถานการณ์`,
  },

  motorcycle_uncertain: {
    topic: 'motorcycle',
    domain: 'accident',
    level: 'yellow',
    priority: 60,

    fact: n =>
      `พบรถจักรยานยนต์เอียงผิดสังเกตในมุมมองที่ ${n} ยังยืนยันไม่ได้ว่าล้ม`,

    follow: n =>
      `ควรตรวจสอบภาพต้นฉบับรถจักรยานยนต์ในมุมมองที่ ${n}`,
  },

  motorcycle_parked: {
    topic: 'motorcycle',
    domain: 'accident',
    level: 'green',
    priority: 10,

    fact: n =>
      `พบรถจักรยานยนต์จอดอยู่บนขาตั้งในมุมมองที่ ${n}`,
  },

  accident_visible: {
    topic: 'accident',
    domain: 'accident',
    level: 'orange',
    priority: 95,

    fact: n =>
      `พบหลักฐานที่อาจเกี่ยวข้องกับอุบัติเหตุในมุมมองที่ ${n} ควรตรวจสอบเพิ่มเติม`,

    follow: n =>
      `ควรตรวจยืนยันเหตุเกี่ยวกับยานพาหนะในมุมมองที่ ${n}`,
  },

  traffic_cones_lane: {
    topic: 'cones',
    domain: 'traffic',
    level: 'yellow',
    priority: 80,

    fact: n =>
      `พบแนวกรวยกำหนดพื้นที่บนผิวจราจรในมุมมองที่ ${n} ยังไม่ยืนยันว่าปิดช่องทาง`,

    follow: n =>
      `ควรตรวจสอบผลของแนวกรวยต่อช่องทางในมุมมองที่ ${n}`,
  },

  traffic_cones: {
    topic: 'cones',
    domain: 'object',
    level: 'green',
    priority: 25,

    fact: n =>
      `พบกรวยจราจรริมทางในมุมมองที่ ${n} ไม่ปรากฏหลักฐานว่ากีดขวาง`,
  },

  barrier_lane: {
    topic: 'barrier',
    domain: 'traffic',
    level: 'yellow',
    priority: 81,

    fact: n =>
      `พบแผงกั้นหรือแนวกั้นบนผิวจราจรในมุมมองที่ ${n}`,

    follow: n =>
      `ควรตรวจสอบผลของแผงกั้นต่อการสัญจรในมุมมองที่ ${n}`,
  },

  roadwork_visible: {
    topic: 'roadwork',
    domain: 'traffic',
    level: 'yellow',
    priority: 82,

    fact: n =>
      `พบการทำงานหรือซ่อมบำรุงบนถนนในมุมมองที่ ${n}`,

    follow: n =>
      `ควรตรวจสอบความปลอดภัยบริเวณทำงานบนถนนในมุมมองที่ ${n}`,
  },

  lane_blocked: {
    topic: 'road_obstruction',
    domain: 'traffic',
    level: 'orange',
    priority: 99,

    fact: n =>
      `พบสิ่งกีดขวางช่องทางจราจรอย่างชัดเจนในมุมมองที่ ${n}`,

    follow: n =>
      `ควรตรวจสอบสิ่งกีดขวางช่องทางในมุมมองที่ ${n}`,
  },

  crowd_on_road: {
    topic: 'road_activity',
    domain: 'crowd',
    level: 'yellow',
    priority: 77,

    fact: n =>
      `พบกลุ่มบุคคลใช้พื้นที่ผิวจราจรในมุมมองที่ ${n}`,

    follow: n =>
      `ควรติดตามความปลอดภัยของผู้คนกับยานพาหนะในมุมมองที่ ${n}`,
  },

  flood_buildings: {
    topic: 'flood_buildings',
    domain: 'disaster',
    level: 'orange',
    priority: 97,

    fact: n =>
      `พบน้ำท่วมประชิดบ้านเรือนหรืออาคารในมุมมองที่ ${n}`,

    follow: n =>
      `ควรตรวจสอบระดับน้ำและผลกระทบต่ออาคารในมุมมองที่ ${n}`,
  },

  flood_road: {
    topic: 'flood_road',
    domain: 'traffic',
    level: 'orange',
    priority: 94,

    fact: n =>
      `พบน้ำท่วมผิวจราจรในมุมมองที่ ${n} อาจกระทบการใช้เส้นทาง`,

    follow: n =>
      `ควรตรวจสอบเส้นทางที่มีน้ำท่วมในมุมมองที่ ${n}`,
  },

  rain_visible: {
    topic: 'rain',
    domain: 'weather',
    level: 'yellow',
    priority: 83,

    fact: n =>
      `พบหลักฐานฝนกำลังตกในมุมมองที่ ${n}`,

    follow: n =>
      `ควรติดตามสภาพฝนและความปลอดภัยในการสัญจรบริเวณมุมมองที่ ${n}`,
  },

  heavy_rain_visible: {
    topic: 'rain',
    domain: 'weather',
    level: 'orange',
    priority: 92,

    fact: n =>
      `พบหลักฐานฝนตกหนักในมุมมองที่ ${n}`,

    follow: n =>
      `ควรเฝ้าระวังสภาพฝนและทัศนวิสัยในมุมมองที่ ${n}`,
  },

  wet_road: {
    topic: 'wet_road',
    domain: 'traffic',
    level: 'yellow',
    priority: 54,

    fact: n =>
      `พบผิวถนนเปียกในมุมมองที่ ${n} แต่ยังไม่ยืนยันว่าฝนกำลังตก`,

    follow: n =>
      `ควรระมัดระวังการขับขี่บนผิวถนนเปียกในมุมมองที่ ${n}`,
  },

  low_visibility: {
    topic: 'weather',
    domain: 'weather',
    level: 'yellow',
    priority: 55,

    fact: n =>
      `แสงสว่างหรือทัศนวิสัยในมุมมองที่ ${n} มีข้อจำกัดต่อการตรวจสอบ`,
  },

  trash_bin: {
    topic: 'trash_bin',
    domain: 'object',
    level: 'green',
    priority: 27,

    fact: n =>
      `พบถังขยะในมุมมองที่ ${n} ไม่ปรากฏหลักฐานว่ากีดขวาง`,
  },

  trash_bag: {
    topic: 'trash_bag',
    domain: 'object',
    level: 'green',
    priority: 28,

    fact: n =>
      `พบถุงขยะในมุมมองที่ ${n} ไม่พบหลักฐานอันตรายจากภาพนิ่ง`,
  },

  garbage_pile: {
    topic: 'garbage',
    domain: 'object',
    level: 'yellow',
    priority: 62,

    fact: n =>
      `พบกองขยะหรือสิ่งของหลายชิ้นในพื้นที่สาธารณะของมุมมองที่ ${n}`,

    follow: n =>
      `ควรตรวจสอบว่ากองสิ่งของในมุมมองที่ ${n} กีดขวางทางเดินหรือไม่`,
  },

  large_bag: {
    topic: 'large_bag',
    domain: 'object',
    level: 'green',
    priority: 24,

    fact: n =>
      `พบถุงหรือกระสอบขนาดใหญ่ในมุมมองที่ ${n} ยังไม่ปรากฏอันตราย`,
  },

  gas_cylinder: {
    topic: 'gas_cylinder',
    domain: 'object',
    level: 'green',
    priority: 32,

    fact: n =>
      `พบวัตถุลักษณะถังแก๊สในมุมมองที่ ${n} ไม่สามารถประเมินเนื้อหาจากภาพได้`,
  },

  fire_extinguisher: {
    topic: 'fire_extinguisher',
    domain: 'object',
    level: 'green',
    priority: 24,

    fact: n =>
      `พบวัตถุลักษณะถังดับเพลิงในมุมมองที่ ${n}`,
  },

  object_obstruction: {
    topic: 'road_obstruction',
    domain: 'object',
    level: 'orange',
    priority: 91,

    fact: n =>
      `พบสิ่งของกีดขวางเส้นทางสัญจรในมุมมองที่ ${n}`,

    follow: n =>
      `ควรตรวจสอบสิ่งของกีดขวางในมุมมองที่ ${n}`,
  },

  /* Normal observations */

  vehicles_moving_normal: {
    topic: 'normal_traffic',
    domain: 'traffic',
    level: 'green',
    priority: 15,

    fact: n =>
      `พบรถยนต์หรือรถจักรยานยนต์สัญจรตามปกติในมุมมองที่ ${n}`,
  },

  roadway_clear: {
    topic: 'normal_traffic',
    domain: 'traffic',
    level: 'green',
    priority: 14,

    fact: n =>
      `ไม่พบสิ่งกีดขวางช่องจราจรที่เห็นได้ชัดในมุมมองที่ ${n}`,
  },

  pedestrians_normal: {
    topic: 'normal_scene',
    domain: 'crowd',
    level: 'green',
    priority: 12,

    fact: n =>
      `พบบุคคลสัญจรหรือทำกิจกรรมทั่วไปในมุมมองที่ ${n} ไม่ปรากฏความแออัดผิดปกติ`,
  },

  clear_visibility: {
    topic: 'normal_scene',
    domain: 'weather',
    level: 'green',
    priority: 11,

    fact: n =>
      `ภาพบริเวณมุมมองที่ ${n} มีทัศนวิสัยเพียงพอสำหรับการตรวจสอบ`,
  },
};

const CUE_LIST = Object.keys(CUES);

/* =========================================
   UTILITIES
========================================= */

const object = x =>
  x && typeof x === 'object' && !Array.isArray(x)
    ? x
    : {};

const str = (x, n = 160) =>
  typeof x === 'string'
    ? x.trim().slice(0, n)
    : '';

const highest = (...xs) =>
  xs.reduce(
    (a, b) =>
      (RANK[b] ?? -1) > (RANK[a] ?? -1)
        ? b
        : a,
    'neutral'
  );

function warning(list, text) {
  if (!list.includes(text)) {
    list.push(text);
  }
}

function enumerated(
  value,
  allowed,
  fallback,
  warn,
  field
) {
  const s = str(value, 100).toLowerCase();

  if (allowed.includes(s)) {
    return s;
  }

  warning(warn, `INVALID_${field}`);

  return fallback;
}

function cams(raw, count) {
  const list = Array.isArray(raw)
    ? raw
    : [raw];

  return [
    ...new Set(
      list
        .map(Number)
        .filter(
          n =>
            Number.isInteger(n) &&
            n >= 1 &&
            n <= count
        )
    ),
  ].sort((a, b) => a - b);
}

function makeItem(
  text,
  severity,
  eventType,
  topic,
  cameras = [],
  origin = 'worker'
) {
  return {
    text: str(text, 155),
    severity,
    eventType,
    topic,
    cameras,
    origin,
  };
}

function addUnique(list, item, limit) {
  if (
    !item?.text ||
    list.length >= limit
  ) {
    return;
  }

  const tidy = s =>
    String(s)
      .replace(/\s+/g, '')
      .toLocaleLowerCase();

  const key = t =>
    ['motorcycle', 'accident'].includes(t)
      ? 'accident_group'
      : t;

  const duplicate = list.some(x => {
    if (
      tidy(x.text) === tidy(item.text)
    ) {
      return true;
    }

    if (
      key(x.topic) !== key(item.topic) ||
      [
        'other',
        'normal_traffic',
        'normal_scene',
      ].includes(key(x.topic))
    ) {
      return false;
    }

    return (
      !x.cameras.length ||
      !item.cameras.length ||
      x.cameras.some(
        c => item.cameras.includes(c)
      )
    );
  });

  if (!duplicate) {
    list.push(item);
  }
}

/* =========================================
   READ AI REPORT ITEMS
========================================= */

function readItems(
  raw,
  count,
  max,
  w,
  path
) {
  if (!Array.isArray(raw)) {
    warning(w, `MISSING_${path}`);
    return [];
  }

  const a = [];

  for (
    const [i, v] of raw
      .slice(0, max)
      .entries()
  ) {
    const x = object(v);
    const text = str(x.text, 140);

    if (
      text.length < 4 ||
      !/[ก-๙]/.test(text)
    ) {
      warning(
        w,
        `INVALID_${path}_${i}_TEXT`
      );
      continue;
    }

    const type = enumerated(
      x.eventType,
      EVENTS,
      'other',
      w,
      `${path}_${i}_TYPE`
    );

    const fallback = ({
      accident: 'accident',
      traffic: 'traffic_flow',
      weather: 'weather',
      flood: 'flood',
      crowd: 'crowd',
      object: 'object',
    })[type] || 'other';

    const topic = enumerated(
      x.topic,
      TOPICS,
      fallback,
      w,
      `${path}_${i}_TOPIC`
    );

    const sev = enumerated(
      x.severity,
      LEVELS,
      'neutral',
      w,
      `${path}_${i}_LEVEL`
    );

    a.push(
      makeItem(
        text,
        sev,
        type,
        topic,
        cams(
          x.cameras ?? x.camera,
          count
        ),
        'ai'
      )
    );
  }

  return a;
}

/* =========================================
   NORMAL OBSERVATIONS
========================================= */

function readNormal(raw, count, w) {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.slice(0, 4).flatMap(v => {
    const x = object(v);

    const text = str(x.text, 130);

    const c = cams(
      x.cameras ?? x.camera,
      count
    );

    if (
      !/[ก-๙]/.test(text) ||
      text.length < 8
    ) {
      return [];
    }

    const topic = enumerated(
      x.topic,
      [
        'normal_traffic',
        'normal_scene',
        'traffic_flow',
      ],
      'normal_scene',
      w,
      'NORMAL_TOPIC'
    );

    return [
      makeItem(
        text,
        'green',
        'other',
        topic,
        c,
        'normal'
      ),
    ];
  });
}

/* =========================================
   OBJECTS
========================================= */

function readObjects(raw, count, w) {
  if (!Array.isArray(raw)) {
    warning(w, 'MISSING_OBJECTS');
    return [];
  }

  return raw.slice(0, 5).flatMap(v => {
    const x = object(v);

    if (x.clearlyVisible !== true) {
      return [];
    }

    const text = str(x.text, 130);

    if (
      text.length < 4 ||
      !/[ก-๙]/.test(text)
    ) {
      return [];
    }

    const type = enumerated(
      x.type,
      OBJECT_TYPES,
      'other',
      w,
      'OBJECT_TYPE'
    );

    const status = enumerated(
      x.status,
      OBJECT_STATUSES,
      'uncertain',
      w,
      'OBJECT_STATUS'
    );

    const topic = ({
      trash_bin: 'trash_bin',
      trash_bag: 'trash_bag',
      sack: 'large_bag',
      large_bag: 'large_bag',
      gas_cylinder: 'gas_cylinder',
      fire_extinguisher:
        'fire_extinguisher',
      traffic_cone: 'cones',
    })[type] || 'object';

    return [{
      ...makeItem(
        text,
        OBJECT_RANKS[status],
        'object',
        topic,
        cams(
          x.cameras ?? x.camera,
          count
        ),
        'object'
      ),
      type,
      status,
    }];
  });
}

/* =========================================
   STRUCTURED EVIDENCE
========================================= */

function readEvidence(raw, w) {
  const e = object(raw);
  const f = object(e.flood);
  const weather = object(e.weather);

  const rawObserved =
    typeof f.observed === 'string'
      ? f.observed.trim().toLowerCase()
      : f.observed;

  let observed =
    rawObserved === true ||
    rawObserved === 'true'
      ? true
      : rawObserved === false ||
        rawObserved === 'false'
        ? false
        : null;

  if (observed === null) {
    warning(
      w,
      'INVALID_FLOOD_OBSERVED'
    );
  }

  const flood = {
    observed,

    extent: enumerated(
      f.extent,
      [
        'none',
        'localized',
        'multiple_areas',
        'uncertain',
      ],
      'uncertain',
      w,
      'FLOOD_EXTENT'
    ),

    buildingImpact: enumerated(
      f.buildingImpact,
      [
        'none',
        'nearby_only',
        'floodwater_reaches_multiple_buildings',
        'uncertain',
      ],
      'uncertain',
      w,
      'FLOOD_BUILDINGS'
    ),

    roadImpact: enumerated(
      f.roadImpact,
      [
        'none',
        'wet_or_minor_puddles',
        'flooded_partial',
        'visibly_impassable',
        'uncertain',
      ],
      'uncertain',
      w,
      'FLOOD_ROAD'
    ),
  };

  if (
    flood.observed === false &&
    (
      [
        'localized',
        'multiple_areas',
      ].includes(flood.extent) ||
      flood.buildingImpact ===
        'floodwater_reaches_multiple_buildings' ||
      [
        'flooded_partial',
        'visibly_impassable',
      ].includes(flood.roadImpact)
    )
  ) {
    warning(
      w,
      'FLOOD_EVIDENCE_CONFLICT'
    );

    flood.observed = null;
    flood.extent = 'uncertain';
    flood.buildingImpact = 'uncertain';
    flood.roadImpact = 'uncertain';
  }

  return {
    flood,

    roadAccess: enumerated(
      e.roadAccess,
      [
        'normal',
        'restricted',
        'blocked_visible',
        'uncertain',
      ],
      'uncertain',
      w,
      'ROAD_ACCESS'
    ),

    roadActivity: enumerated(
      e.roadActivity,
      [
        'none',
        'roadside_only',
        'people_on_carriageway',
        'organized_use_of_carriageway',
        'uncertain',
      ],
      'uncertain',
      w,
      'ROAD_ACTIVITY'
    ),

    weatherVisibility: enumerated(
      weather.visibility ??
        e.weatherVisibility,
      [
        'normal',
        'reduced',
        'severely_reduced',
        'uncertain',
      ],
      'uncertain',
      w,
      'VISIBILITY'
    ),

    precipitation: enumerated(
      weather.precipitation ??
        e.precipitation,
      PRECIP,
      'uncertain',
      w,
      'PRECIPITATION'
    ),

    accidentScale: enumerated(
      e.accidentScale,
      [
        'none',
        'minor_visible',
        'major_visible',
        'uncertain',
      ],
      'uncertain',
      w,
      'ACCIDENT'
    ),

    crowdCondition: enumerated(
      e.crowdCondition,
      [
        'normal',
        'dense',
        'dangerous_compression_visible',
        'uncertain',
      ],
      'uncertain',
      w,
      'CROWD'
    ),

    objectImpact: enumerated(
      e.objectImpact,
      [
        'none',
        'present_not_obstructing',
        'obstructing',
        'immediate_hazard_visible',
        'uncertain',
      ],
      'uncertain',
      w,
      'OBJECT'
    ),

    otherDisaster: enumerated(
      e.otherDisaster,
      [
        'none',
        'significant_visible',
        'emergency_visible',
        'uncertain',
      ],
      'uncertain',
      w,
      'DISASTER'
    ),

    support: str(e.support, 240),
  };
}

/* =========================================
   MOTORCYCLE POSTURE CHECKS
========================================= */

function readBikes(raw, count, w) {
  const m = new Map();

  if (!Array.isArray(raw)) {
    warning(
      w,
      'MISSING_MOTORCYCLE_CHECKS'
    );

    return m;
  }

  for (
    const row of raw.slice(0, count * 2)
  ) {
    const r = object(row);
    const n = Number(r.camera);

    if (
      !Number.isInteger(n) ||
      n < 1 ||
      n > count ||
      m.has(n)
    ) {
      continue;
    }

    m.set(n, {
      posture: enumerated(
        r.posture,
        POSTURES,
        'uncertain',
        w,
        `BIKE_${n}`
      ),

      sideOnGround:
        r.sideOnGround === true,

      standVisible:
        r.standVisible === true,

      imageClear:
        r.imageClear === true,

      fallEvidence: enumerated(
        r.fallEvidence,
        FALL_EVIDENCE,
        'uncertain',
        w,
        `BIKE_FALL_EVIDENCE_${n}`
      ),
    });
  }

  return m;
}

/* =========================================
   CAMERA CHECKS
========================================= */

function readCameras(
  raw,
  count,
  bikes,
  w
) {
  const map = new Map();

  if (!Array.isArray(raw)) {
    warning(
      w,
      'MISSING_CAMERA_CHECKS'
    );
  }

  for (
    const row of (
      Array.isArray(raw) ? raw : []
    )
  ) {
    const n = Number(
      Array.isArray(row)
        ? row[0]
        : object(row).camera
    );

    if (
      !Number.isInteger(n) ||
      n < 1 ||
      n > count ||
      map.has(n)
    ) {
      continue;
    }

    const items = Array.isArray(row)
      ? row.slice(1)
      : object(row).cues;

    if (
      !Array.isArray(items) ||
      !items.length
    ) {
      continue;
    }

    const rawCodes = [
      ...new Set(
        items
          .filter(
            x => typeof x === 'string'
          )
          .map(
            x => x.trim().toLowerCase()
          )
      ),
    ];

    const recognized =
      rawCodes.filter(
        x => CUE_LIST.includes(x)
      );

    if (
      rawCodes.some(
        x =>
          !CUE_LIST.includes(x) &&
          x !== 'none' &&
          x !== 'unclear'
      )
    ) {
      warning(
        w,
        `INVALID_CUE_CAMERA_${n}`
      );
    }

    if (
      !recognized.length &&
      !rawCodes.includes('none') &&
      !rawCodes.includes('unclear')
    ) {
      continue;
    }

    let codes = recognized.slice(0, 4);

    if (
      !codes.length &&
      rawCodes.includes('unclear')
    ) {
      codes = ['unclear'];
    }

    /* Motorcycle verification V12.5.1 */

const bike = bikes.get(n);

const parked =
  bike &&
  [
    'upright',
    'parked_on_stand',
  ].includes(bike.posture);

const hasBikeCue = codes.some(
  x =>
    [
      'motorcycle_fallen',
      'motorcycle_uncertain',
      'motorcycle_parked',
    ].includes(x)
);

if (hasBikeCue) {
  const claimedFall = codes.includes(
    'motorcycle_fallen'
  );

  // Remove original motorcycle classification
  // before applying the stricter evidence checks.

  codes = codes.filter(
    x =>
      ![
        'motorcycle_fallen',
        'motorcycle_uncertain',
        'motorcycle_parked',
      ].includes(x)
  );

  const confirmed =
    Boolean(bike) &&

    bike.posture === 'fallen_on_side' &&

    bike.sideOnGround === true &&

    bike.standVisible === false &&

    bike.imageClear === true &&

    [
      'side_and_handlebar_ground',
      'side_and_wheels_horizontal',
    ].includes(bike.fallEvidence);

  if (parked) {
    // Motorcycle supported normally.
    // Do not create an accident alert.

    codes.push('motorcycle_parked');

  } else if (confirmed) {
    // Strong visual evidence of a fallen bike.

    codes.push('motorcycle_fallen');

  } else if (
    bike?.imageClear === true &&

    bike?.sideOnGround === true &&

    bike?.standVisible === false &&

    bike?.fallEvidence === 'uncertain'
  ) {
    // Some evidence exists, but it is
    // not sufficient to confirm a fall.

    codes.push('motorcycle_uncertain');

    warning(
      w,
      `MOTORCYCLE_NEEDS_REVIEW_${n}`
    );

  } else if (claimedFall) {
    // Unsupported fall claim.
    // Do not publish a fall finding.

    warning(
      w,
      `UNCONFIRMED_MOTORCYCLE_FALL_${n}`
    );
  }
}

    map.set(
      n,
      [...new Set(codes)]
    );
  }

  if (map.size < count) {
    warning(
      w,
      `PARTIAL_CAMERA_COVERAGE_${map.size}_OF_${count}`
    );
  }

  const cameraChecks = [];
  const byCode = new Map();

  for (
    let n = 1;
    n <= count;
    n++
  ) {
    const codes = map.get(n) || [];

    cameraChecks.push({
      camera: n,
      checked: map.has(n),
      cues: codes,
    });

    for (const code of codes) {
      if (!CUES[code]) {
        continue;
      }

      if (!byCode.has(code)) {
        byCode.set(
          code,
          {
            code,
            ...CUES[code],
            cameras: [],
          }
        );
      }

      byCode
        .get(code)
        .cameras
        .push(n);
    }
  }

  return {
    cameraChecks,

    detections: [
      ...byCode.values(),
    ].sort(
      (a, b) =>
        b.priority - a.priority
    ),

    covered: map.size,
    expected: count,

    allUnclear:
      !cameraChecks.some(
        x =>
          x.checked &&
          !x.cues.includes('unclear')
      ),
  };
}

/* =========================================
   RAIN ANALYSIS
========================================= */

function rainState(e, d, w) {
  const heavy = d.find(
    x =>
      x.code === 'heavy_rain_visible'
  );

  const light = d.find(
    x =>
      x.code === 'rain_visible'
  );

  const wet = d.find(
    x =>
      x.code === 'wet_road'
  );

  const cameraRain = Boolean(
    heavy || light
  );

  const structured = [
    'rain_visible',
    'heavy_rain_visible',
  ].includes(e.precipitation);

  // Require agreement between the
  // per-camera and structured findings.

  if (cameraRain !== structured) {
    warning(
      w,
      'RAIN_EVIDENCE_NOT_CORROBORATED'
    );
  }

  const confirmed =
    cameraRain && structured;

  const cameras = confirmed
    ? [
        ...new Set([
          ...(heavy?.cameras || []),
          ...(light?.cameras || []),
        ]),
      ].sort((a, b) => a - b)
    : [];

  return {
    confirmed,

    // Do not create an unconfirmed
    // rain alert from inconsistent fields.
    probable: false,

    inconsistent: cameraRain !== structured,

    heavy:
      confirmed &&
      Boolean(heavy) &&
      e.precipitation ===
        'heavy_rain_visible',

    wet:
      Boolean(wet) ||
      e.precipitation ===
        'wet_surface_only',

    cameras,
  };
}

/* =========================================
   EVIDENCE SEVERITY FLOORS
========================================= */

function severityFloors(
  e,
  objects,
  d,
  rain,
  w
) {
  const f = Object.fromEntries(
    DOMAINS.map(
      k => [k, 'neutral']
    )
  );

  const baseline = {
    traffic:
      e.roadAccess === 'normal'
        ? 'green'
        : 'neutral',

    weather:
      e.weatherVisibility === 'normal' &&
      [
        'none',
        'wet_surface_only',
      ].includes(e.precipitation)
        ? 'green'
        : 'neutral',

    disaster:
      e.flood.observed === false &&
      e.otherDisaster === 'none'
        ? 'green'
        : 'neutral',

    accident:
      e.accidentScale === 'none'
        ? 'green'
        : 'neutral',

    crowd:
      e.crowdCondition === 'normal'
        ? 'green'
        : 'neutral',

    object:
      [
        'none',
        'present_not_obstructing',
      ].includes(e.objectImpact)
        ? 'green'
        : 'neutral',
  };

  Object.assign(f, baseline);

  /* Flood */

  if (e.flood.observed === true) {
    f.disaster =
      e.flood.buildingImpact ===
        'floodwater_reaches_multiple_buildings' ||
      (
        e.flood.extent ===
          'multiple_areas' &&
        e.flood.roadImpact ===
          'visibly_impassable'
      )
        ? 'red'
        : e.flood.extent ===
            'multiple_areas' ||
          [
            'flooded_partial',
            'visibly_impassable',
          ].includes(e.flood.roadImpact)
          ? 'orange'
          : 'yellow';

    if (
      e.flood.roadImpact ===
      'flooded_partial'
    ) {
      f.traffic = highest(
        f.traffic,
        'orange'
      );
    }

    if (
      e.flood.roadImpact ===
      'visibly_impassable'
    ) {
      f.traffic = 'red';
    }
  }

  /* Traffic */

  if (
    e.roadAccess === 'blocked_visible'
  ) {
    f.traffic = highest(
      f.traffic,
      'orange'
    );
  }

  if (
    e.roadAccess === 'restricted'
  ) {
    f.traffic = highest(
      f.traffic,
      'yellow'
    );
  }

  if (
    e.roadActivity ===
    'people_on_carriageway'
  ) {
    f.crowd = highest(
      f.crowd,
      'yellow'
    );
  }

  // Activity alone does not prove
  // a blocked or abnormal road.

  if (
    e.roadActivity ===
    'organized_use_of_carriageway'
  ) {
    f.traffic = highest(
      f.traffic,
      'yellow'
    );
  }

  /* Weather */

  if (
    e.weatherVisibility === 'reduced'
  ) {
    f.weather = highest(
      f.weather,
      'yellow'
    );
  }

  if (
    e.weatherVisibility ===
    'severely_reduced'
  ) {
    f.weather = highest(
      f.weather,
      'orange'
    );
  }

  /* Crowd */

  if (
    e.crowdCondition === 'dense'
  ) {
    f.crowd = highest(
      f.crowd,
      'yellow'
    );
  }

  if (
    e.crowdCondition ===
    'dangerous_compression_visible'
  ) {
    f.crowd = 'red';
  }

  /* Objects */

  if (
    e.objectImpact === 'obstructing'
  ) {
    f.object = highest(
      f.object,
      'orange'
    );
  }

  if (
    e.objectImpact ===
    'immediate_hazard_visible'
  ) {
    f.object = 'red';
  }

  /* Disaster */

  if (
    e.otherDisaster ===
    'significant_visible'
  ) {
    f.disaster = highest(
      f.disaster,
      'orange'
    );
  }

  if (
    e.otherDisaster ===
    'emergency_visible'
  ) {
    f.disaster = 'red';
  }

  /* Observed objects */

  for (const o of objects) {
    f.object = highest(
      f.object,
      o.severity
    );
  }

  /* Camera detections */

  for (const x of d) {
    if (
      [
        'motorcycle_parked',
        'rain_visible',
        'heavy_rain_visible',
      ].includes(x.code)
    ) {
      continue;
    }

    f[x.domain] = highest(
      f[x.domain],
      x.level
    );
  }

  /* Rain */

  if (rain.confirmed) {
    f.weather = highest(
      f.weather,
      rain.heavy
        ? 'orange'
        : 'yellow'
    );
  } else if (rain.probable) {
    f.weather = highest(
      f.weather,
      'yellow'
    );
  }

  /* Accident verification */

  const confirmedAccident = d.some(
    x =>
      [
        'motorcycle_fallen',
        'accident_visible',
      ].includes(x.code)
  );

  if (confirmedAccident) {
    f.accident = highest(
      f.accident,

      e.accidentScale ===
        'major_visible' &&
      d.some(
        x =>
          x.code === 'accident_visible'
      )
        ? 'red'
        : 'orange'
    );
    } else if (
      [
        'minor_visible',
        'major_visible',
      ].includes(e.accidentScale)
    ) {
      // The model claims an accident,
      // but no corroborating camera cue
      // has been accepted.

      warning(
        w,
        'ACCIDENT_SCALE_NOT_CORROBORATED'
      );

      // Do not raise severity based on
      // an unsupported accident claim.
    }

  return f;
}

/* =========================================
   SHORT SUMMARY — SECTION 1
========================================= */

function summary(
  key,
  level,
  e,
  d,
  rain
) {
  const has = code =>
    d.some(
      x => x.code === code
    );

  const f = e.flood;

  if (
    key === 'visibility' &&
    rain.inconsistent &&
    level === 'neutral'
  ) {
    return 'ยังไม่สามารถยืนยันสถานะฝนตกได้';
  }

  if (level === 'neutral') {
    return 'ข้อมูลภาพยังไม่เพียงพอต่อการประเมิน';
  }

  if (level === 'green') {
    return ({
      safety:
        'ความเรียบร้อยทั่วไปปกติ',

      traffic:
        'การจราจรเป็นปกติ',

      abnormal:
        'ไม่พบเหตุผิดปกติเด่นชัด',

      visibility:
        rain.wet
          ? 'ทัศนวิสัยปกติ พบผิวถนนเปียก'
          : 'สภาพอากาศและทัศนวิสัยปกติ',
    })[key];
  }

  if (key === 'safety') {
    if (
      f.observed === true &&
      f.buildingImpact ===
        'floodwater_reaches_multiple_buildings'
    ) {
      return 'พบภัยพิบัติกระทบพื้นที่ชุมชน';
    }

    if (
      has('motorcycle_fallen') ||
      has('accident_visible')
    ) {
      return 'พบเหตุที่ควรตรวจสอบในพื้นที่';
    }

    if (
      e.crowdCondition ===
      'dangerous_compression_visible'
    ) {
      return 'พบความแออัดเสี่ยงอันตราย';
    }

    if (
      e.crowdCondition === 'dense' ||
      has('crowd_on_road')
    ) {
      return 'พบกลุ่มบุคคลหนาแน่นในพื้นที่';
    }

    if (
      has('motorcycle_uncertain')
    ) {
      return 'พบยานพาหนะลักษณะผิดสังเกต';
    }

    if (f.observed === true) {
      return 'พบสถานการณ์น้ำท่วมในพื้นที่';
    }

    if (
      e.objectImpact === 'obstructing'
    ) {
      return 'พบสิ่งของกีดขวางทางสัญจร';
    }
  }

  if (key === 'traffic') {
    if (
      f.observed === true &&
      f.roadImpact ===
        'visibly_impassable'
    ) {
      return 'พบเส้นทางน้ำท่วมจนผ่านไม่ได้';
    }

    if (
      f.observed === true &&
      f.roadImpact === 'flooded_partial'
    ) {
      return 'พบน้ำท่วมผิวจราจรบางส่วน';
    }

    if (
      has('lane_blocked') ||
      e.roadAccess === 'blocked_visible'
    ) {
      return 'พบสิ่งกีดขวางช่องทางจราจร';
    }

    if (
      has('traffic_cones_lane') ||
      has('barrier_lane')
    ) {
      return 'พบแนวกรวยหรือแผงกั้นบนผิวจราจร';
    }

    if (has('roadwork_visible')) {
      return 'พบการทำงานบนผิวจราจร';
    }

    if (
      e.roadActivity ===
      'organized_use_of_carriageway'
    ) {
      return 'พบการใช้พื้นที่ผิวจราจร';
    }

    if (has('wet_road')) {
      return 'พบผิวถนนเปียก ควรระมัดระวัง';
    }
  }

  if (key === 'abnormal') {
    if (
      f.observed === true &&
      f.buildingImpact ===
        'floodwater_reaches_multiple_buildings'
    ) {
      return 'พบน้ำท่วมประชิดอาคารหลายหลัง';
    }

    if (
      e.otherDisaster ===
      'emergency_visible'
    ) {
      return 'พบเหตุภัยพิบัติที่ควรตรวจสอบ';
    }

    if (has('motorcycle_fallen')) {
      return 'พบรถจักรยานยนต์ล้ม';
    }

    if (has('accident_visible')) {
      return 'พบเหตุยานพาหนะที่ควรตรวจสอบ';
    }

    if (
      has('motorcycle_uncertain')
    ) {
      return 'พบรถจักรยานยนต์เอียงผิดสังเกต';
    }

    if (f.observed === true) {
      return 'พบสถานการณ์น้ำท่วมในพื้นที่';
    }
  }

  if (key === 'visibility') {
    if (rain.heavy) {
      return 'พบฝนตกหนักในพื้นที่';
    }

    if (rain.confirmed) {
      return 'พบฝนกำลังตกในพื้นที่';
    }

    if (rain.probable) {
      return 'มีข้อบ่งชี้ฝนตก ควรตรวจสอบ';
    }

    if (
      e.weatherVisibility ===
      'severely_reduced'
    ) {
      return 'ทัศนวิสัยลดลงอย่างมาก';
    }

    if (
      e.weatherVisibility === 'reduced' ||
      has('low_visibility')
    ) {
      return 'ทัศนวิสัยลดลงบางพื้นที่';
    }

    if (rain.wet) {
      return 'พบถนนเปียก ยังไม่ยืนยันฝนตก';
    }
  }

  return level === 'yellow'
    ? 'มีประเด็นที่ควรเฝ้าระวังเพิ่มเติม'
    : 'มีประเด็นที่ควรตรวจสอบเพิ่มเติม';
}

/* =========================================
   MOTORCYCLE REPORT
========================================= */

function moto(d) {
  const fallen = d.find(
    x =>
      x.code === 'motorcycle_fallen'
  );

  const uncertain = d.find(
    x =>
      x.code === 'motorcycle_uncertain'
  );

  if (!fallen && !uncertain) {
    return null;
  }

  const nums = [
    ...new Set([
      ...(fallen?.cameras || []),
      ...(uncertain?.cameras || []),
    ]),
  ].sort((a, b) => a - b);

  const level = fallen
    ? 'orange'
    : 'yellow';

  const fact =
    fallen && uncertain
      ? `พบรถจักรยานยนต์ล้มในมุมมองที่ ${fallen.cameras.join(', ')} และรถเอียงที่ยังไม่ยืนยันการล้มในมุมมองที่ ${uncertain.cameras.join(', ')}`
      : fallen
        ? fallen.fact(
            fallen.cameras.join(', ')
          )
        : uncertain.fact(
            uncertain.cameras.join(', ')
          );

  return {
    fact: makeItem(
      fact,
      level,
      'accident',
      'motorcycle',
      nums
    ),

    follow: makeItem(
      `ควรตรวจยืนยันสภาพรถจักรยานยนต์ในมุมมองที่ ${nums.join(', ')} จากภาพต้นฉบับ`,
      level,
      'accident',
      'motorcycle',
      nums
    ),
  };
}

/* =========================================
   CAMERA REPORT ITEMS
========================================= */

function detItem(
  d,
  follow = false
) {
  return makeItem(
    follow && d.follow
      ? d.follow(
          d.cameras.join(', ')
        )
      : d.fact(
          d.cameras.join(', ')
        ),

    d.level,

    d.domain === 'disaster'
      ? 'flood'
      : d.domain,

    d.topic,
    d.cameras
  );
}

/* =========================================
   BUILD FINAL REPORT
========================================= */

function buildReport(data, count) {
  const w = [];
  const src = object(data);

  const e = readEvidence(
    src.evidence,
    w
  );

  const objects = readObjects(
    src.observedObjects,
    count,
    w
  );

  const bikes = readBikes(
    src.motorcycleChecks,
    count,
    w
  );

  const camera = readCameras(
    src.cameraChecks,
    count,
    bikes,
    w
  );

  const d = camera.detections;

  const rain = rainState(
    e,
    d,
    w
  );

  const floors = severityFloors(
    e,
    objects,
    d,
    rain,
    w
  );

  /* =================================
     CATEGORY SEVERITY
  ================================= */

  const rawCat = object(
    src.categorySeverity
  );

  const categories = {};

  for (const key of DOMAINS) {
    const proposed = enumerated(
      rawCat[key],
      LEVELS,
      'neutral',
      w,
      `CATEGORY_${key}`
    );

        // Do not let an unsupported accident
        // category create a false alert.

        if (
          key === 'accident' &&

          !d.some(
            x =>
              [
                'motorcycle_fallen',
                'motorcycle_uncertain',
                'accident_visible',
              ].includes(x.code)
          )
        ) {
          if (RANK[proposed] > RANK.green) {
            warning(
              w,
              'ACCIDENT_CATEGORY_NOT_CORROBORATED'
            );
          }

          categories[key] = floors[key];

          continue;
        }

        // Do not elevate weather severity
        // solely from inconsistent rain data
        // when visibility is normal.

        if (
          key === 'weather' &&

          !rain.confirmed &&

          e.weatherVisibility === 'normal'
        ) {
          if (RANK[proposed] > RANK.green) {
            warning(
              w,
              'WEATHER_CATEGORY_NOT_CORROBORATED'
            );
          }

          categories[key] = floors[key];

          continue;
        }

    if (
      RANK[proposed] >= RANK.orange &&
      RANK[floors[key]] < RANK.yellow
    ) {
      warning(
        w,
        `UNSUPPORTED_CATEGORY_${key}`
      );

      // Do not confirm orange/red
      // without corroborating evidence.

      categories[key] = 'yellow';
    } else {
      categories[key] = floors[key];
    }
  }

  if (
    rain.inconsistent &&
    categories.weather === 'green'
  ) {
    categories.weather = 'neutral';
  }

  /* =================================
     SUMMARY SEVERITY
  ================================= */

  const summaryFloor = {
    safety: highest(
      categories.crowd,
      categories.object,
      categories.accident,
      categories.disaster
    ),

    traffic:
      categories.traffic,

    abnormal: highest(
      categories.disaster,
      categories.accident,

      RANK[categories.object] >=
        RANK.orange
        ? categories.object
        : 'neutral'
    ),

    visibility:
      categories.weather,
  };

  const report = {};
  const summarySeverity = {};

  for (const key of KEYS) {
    const raw = object(
      object(src.summary)[key]
    );

    enumerated(
      raw.severity,
      LEVELS,
      'neutral',
      w,
      `SUMMARY_${key}`
    );

    let level = summaryFloor[key];

    if (
      camera.allUnclear ||
      (
        camera.covered < count &&
        RANK[level] <= 0
      )
    ) {
      level = 'neutral';
    }

    const unclear =
      key === 'visibility'
        ? (
            e.precipitation === 'uncertain' &&
            e.weatherVisibility === 'uncertain'
          )
        : key === 'traffic'
          ? (
              e.roadAccess === 'uncertain' &&
              e.roadActivity === 'uncertain'
            )
          : key === 'abnormal'
            ? (
                e.accidentScale === 'uncertain' &&
                e.otherDisaster === 'uncertain' &&
                e.flood.observed === null
              )
            : (
                e.crowdCondition === 'uncertain' &&
                e.objectImpact === 'uncertain'
              );

    if (
      level === 'green' &&
      unclear
    ) {
      level = 'neutral';
    }

    summarySeverity[key] = level;

    report[key] = summary(
      key,
      level,
      e,
      d,
      rain
    );
  }

  /* =================================
     READ AI CONTENT
  ================================= */

  const findings = [];
  const traffic = [];
  const highlights = [];

  const mot = moto(d);

  const aiFind = readItems(
    src.findings,
    count,
    5,
    w,
    'FINDINGS'
  );

  const aiTraffic = readItems(
    src.trafficFindings,
    count,
    3,
    w,
    'TRAFFIC'
  );

  const aiHighlights = readItems(
    src.highlights,
    count,
    3,
    w,
    'HIGHLIGHTS'
  );

  const normal = readNormal(
    src.normalObservations,
    count,
    w
  );

  /* =================================
     SECTION 2 — IMPORTANT FINDINGS
  ================================= */

  if (mot) {
    addUnique(
      findings,
      mot.fact,
      5
    );
  }

  /* Major flood */

  if (
    e.flood.observed === true &&
    e.flood.buildingImpact ===
      'floodwater_reaches_multiple_buildings'
  ) {
    addUnique(
      findings,

      makeItem(
        'พบน้ำท่วมเข้าประชิดอาคารหลายหลัง ควรตรวจสอบผลกระทบต่อพื้นที่ชุมชน',
        'red',
        'flood',
        'flood_buildings'
      ),

      5
    );
  }

  /* Rain */

  if (
    rain.confirmed ||
    rain.probable
  ) {
    const where =
      rain.cameras.length
        ? `ในมุมมองที่ ${rain.cameras.join(', ')}`
        : 'จากภาพรวม';

    const text =
      rain.confirmed
        ? `พบ${rain.heavy ? 'ฝนตกหนัก' : 'ฝนกำลังตก'}${where}`
        : `พบข้อบ่งชี้ฝนตก${where} แต่ยังยืนยันไม่ได้`;

    addUnique(
      findings,

      makeItem(
        text,
        rain.heavy
          ? 'orange'
          : 'yellow',

        'weather',
        'rain',
        rain.cameras
      ),

      5
    );
  }

  /* High priority detections */

  for (
    const x of d.filter(
      x =>
        x.priority >= 70 &&
        ![
          'motorcycle_fallen',
          'motorcycle_uncertain',
          'motorcycle_parked',
          'rain_visible',
          'heavy_rain_visible',
        ].includes(x.code)
    )
  ) {
    addUnique(
      findings,
      detItem(x),
      5
    );
  }

  /* Model findings */

  for (const x of aiFind) {
    if (
      [
        'motorcycle',
        'accident',
        'rain',
      ].includes(x.topic) ||
      x.eventType === 'accident' ||
      (
        x.eventType === 'weather' &&
        !rain.confirmed &&
        !rain.probable
      )
    ) {
      continue;
    }

    if (
      x.severity === 'neutral' ||
      RANK[x.severity] <= RANK.green
    ) {
      if (
        camera.covered === count &&
        !camera.allUnclear
      ) {
        addUnique(
          findings,
          {
            ...x,
            severity: 'green',
          },
          5
        );
      }
    } else if (
      d.some(
        y => y.topic === x.topic
      ) ||
      (
        x.eventType === 'flood' &&
        e.flood.observed === true
      )
    ) {
      addUnique(
        findings,
        x,
        5
      );
    }
  }

  /* Lower priority camera observations */

  for (
    const x of d.filter(
      x =>
        x.priority < 70 &&
        ![
          'motorcycle_fallen',
          'motorcycle_uncertain',
          'motorcycle_parked',
        ].includes(x.code) &&
        ![
          'normal_traffic',
          'normal_scene',
        ].includes(x.topic)
    )
  ) {
    if (
      x.code === 'wet_road' &&
      (
        rain.confirmed ||
        rain.probable
      )
    ) {
      continue;
    }

    addUnique(
      findings,
      detItem(x),
      5
    );
  }

  /* Objects */

  for (const x of objects) {
    addUnique(
      findings,
      x,
      5
    );
  }

  /* =================================
     ELEVATED CATEGORIES MUST HAVE
     A SUPPORTING REPORT ITEM
  ================================= */

  if (
    RANK[categories.crowd] >= 1 &&
    !findings.some(
      x => x.eventType === 'crowd'
    )
  ) {
    addUnique(
      findings,

      makeItem(
        'ผลประเมินภาพพบความหนาแน่นของบุคคล ควรตรวจยืนยันสภาพพื้นที่',
        categories.crowd,
        'crowd',
        'crowd'
      ),

      5
    );
  }

  if (
    RANK[categories.object] >= 1 &&
    !findings.some(
      x => x.eventType === 'object'
    )
  ) {
    addUnique(
      findings,

      makeItem(
        'ผลประเมินภาพพบสิ่งของที่อาจมีผลต่อการใช้พื้นที่ ควรตรวจสอบ',
        categories.object,
        'object',
        'object'
      ),

      5
    );
  }

  if (
    RANK[categories.disaster] >= 1 &&
    !findings.some(
      x =>
        x.eventType === 'flood' ||
        x.eventType === 'disaster'
    )
  ) {
    addUnique(
      findings,

      makeItem(
        'ผลประเมินภาพมีข้อบ่งชี้ภัยพิบัติ ควรตรวจสอบสถานที่จริงเพื่อยืนยัน',
        categories.disaster,
        'disaster',
        'other'
      ),

      5
    );
  }

  if (
    RANK[categories.accident] >= 1 &&
    !findings.some(
      x => x.eventType === 'accident'
    )
  ) {
    addUnique(
      findings,

      makeItem(
        'ผลประเมินภาพมีข้อบ่งชี้เกี่ยวกับอุบัติเหตุ แต่ยังต้องตรวจสอบยืนยัน',
        categories.accident,
        'accident',
        'accident'
      ),

      5
    );
  }

  if (
    RANK[categories.traffic] >= 1 &&
    !findings.some(
      x => x.eventType === 'traffic'
    )
  ) {
    const wet = d.find(
      x => x.code === 'wet_road'
    );

    const text = wet
      ? `พบผิวถนนเปียกในมุมมองที่ ${wet.cameras.join(', ')} ควรระมัดระวังการสัญจร`
      : 'ผลประเมินภาพมีข้อสังเกตด้านการใช้พื้นที่จราจร ควรตรวจสอบเพิ่มเติม';

    addUnique(
      findings,

      makeItem(
        text,
        categories.traffic,
        'traffic',

        wet
          ? 'wet_road'
          : 'road_activity',

        wet?.cameras || []
      ),

      5
    );
  }

  /* =================================
     ADD NORMAL OBSERVATIONS

     Do not leave Section 2 empty
     when the inspected scene is normal.
  ================================= */

  if (findings.length < 3) {
    for (const x of normal) {
      if (
        camera.covered === count &&
        !camera.allUnclear
      ) {
        addUnique(
          findings,
          x,
          5
        );
      }
    }

    for (
      const x of d.filter(
        x =>
          [
            'vehicles_moving_normal',
            'roadway_clear',
            'pedestrians_normal',
            'clear_visibility',
          ].includes(x.code)
      )
    ) {
      addUnique(
        findings,
        detItem(x),
        5
      );
    }
  }

  /* Absolute fallback */

  if (!findings.length) {
    const complete =
      camera.covered === count &&
      !camera.allUnclear;

    addUnique(
      findings,

      makeItem(
        complete
          ? 'จากภาพที่ตรวจสอบ ไม่พบเหตุผิดปกติเด่นชัดในมุมมองที่ประเมินได้'
          : 'ตรวจภาพได้เพียงบางมุมหรือรายละเอียดไม่เพียงพอ ยังไม่สามารถยืนยันสถานการณ์โดยรวม',

        complete
          ? 'green'
          : 'neutral',

        'other',
        'normal_scene'
      ),

      5
    );

    if (complete) {
      addUnique(
        findings,

        makeItem(
          'ยังไม่พบหลักฐานอุบัติเหตุหรือสิ่งกีดขวางสำคัญจากภาพนิ่งที่ตรวจสอบ',
          'green',
          'other',
          'normal_scene'
        ),

        5
      );
    }
  }

  /* =================================
     SECTION 3 — TRAFFIC ANALYSIS
  ================================= */

  for (
    const x of d.filter(
      x =>
        [
          'traffic_cones_lane',
          'barrier_lane',
          'lane_blocked',
          'roadwork_visible',
          'flood_road',
          'wet_road',
        ].includes(x.code)
    )
  ) {
    const n = x.cameras.join(', ');

    const texts = {
      traffic_cones_lane:
        `แนวกรวยในมุมมองที่ ${n} อาจลดพื้นที่สัญจร ควรตรวจสอบ`,

      barrier_lane:
        `แผงกั้นบนผิวถนนในมุมมองที่ ${n} อาจมีผลต่อช่องทาง`,

      lane_blocked:
        `พบการกีดขวางช่องทางในมุมมองที่ ${n}`,

      roadwork_visible:
        `พบการทำงานบนผิวจราจรในมุมมองที่ ${n}`,

      flood_road:
        `น้ำท่วมผิวถนนในมุมมองที่ ${n} อาจกระทบการใช้เส้นทาง`,

      wet_road:
        `ผิวจราจรเปียกในมุมมองที่ ${n} ควรระมัดระวังการขับขี่`,
    };

    addUnique(
      traffic,

      makeItem(
        texts[x.code],
        x.level,
        'traffic',
        x.topic,
        x.cameras
      ),

      3
    );
  }

  /* Additional AI traffic findings */

  for (const x of aiTraffic) {
    if (
      [
        'accident',
        'motorcycle',
        'rain',
      ].includes(x.topic) ||
      x.eventType === 'accident'
    ) {
      continue;
    }

    if (
      RANK[x.severity] >= RANK.yellow
    ) {
      if (
        d.some(
          z => z.topic === x.topic
        ) ||
        (
          RANK[categories.traffic] >=
            RANK.yellow &&
          e.roadAccess !== 'normal'
        )
      ) {
        addUnique(
          traffic,
          x,
          3
        );
      }
    } else if (
      camera.covered === count &&
      !camera.allUnclear
    ) {
      addUnique(
        traffic,
        {
          ...x,
          severity: 'green',
        },
        3
      );
    }
  }

  /* Traffic fallback */

  if (!traffic.length) {
    const level =
      summarySeverity.traffic;

    const text =
      level === 'neutral'
        ? 'ข้อมูลภาพไม่เพียงพอสำหรับยืนยันสภาพการจราจร'
        : RANK[level] >= RANK.yellow
          ? 'พบประเด็นการใช้ผิวจราจรที่ควรตรวจสอบจากภาพต้นฉบับ'
          : 'จากภาพที่ตรวจสอบ การสัญจรเป็นปกติ ไม่พบการปิดช่องทางที่ชัดเจน';

    addUnique(
      traffic,

      makeItem(
        text,
        level,
        'traffic',
        'traffic_flow'
      ),

      3
    );
  }

  /* =================================
     SECTION 4 — HIGHLIGHTS
  ================================= */

  if (mot) {
    addUnique(
      highlights,
      mot.follow,
      3
    );
  }

  for (
    const x of d.filter(
      x =>
        x.follow &&
        RANK[x.level] >= RANK.yellow &&
        ![
          'motorcycle_fallen',
          'motorcycle_uncertain',
          'rain_visible',
          'heavy_rain_visible',
        ].includes(x.code)
    )
  ) {
    addUnique(
      highlights,
      detItem(x, true),
      3
    );
  }

  /* Rain follow-up */

  if (
    rain.confirmed ||
    rain.probable
  ) {
    addUnique(
      highlights,

      makeItem(
        'ควรติดตามสภาพฝนและตรวจสอบความปลอดภัยของผู้ใช้รถใช้ถนน',
        rain.heavy
          ? 'orange'
          : 'yellow',
        'weather',
        'rain',
        rain.cameras
      ),

      3
    );
  }

  /* Additional AI highlights */

  for (const x of aiHighlights) {
    if (
      RANK[x.severity] < RANK.yellow ||
      [
        'motorcycle',
        'accident',
        'rain',
      ].includes(x.topic)
    ) {
      continue;
    }

    if (
      d.some(
        z => z.topic === x.topic
      ) ||
      (
        x.eventType === 'flood' &&
        e.flood.observed === true
      )
    ) {
      addUnique(
        highlights,
        x,
        3
      );
    }
  }

  /* No significant incident fallback */

  if (!highlights.length) {
    const elevated =
      Object.values(categories).some(
        x =>
          RANK[x] >= RANK.yellow
      );

    const incomplete =
      camera.covered < count ||
      camera.allUnclear;

    const text = elevated
      ? 'มีข้อสังเกตที่ควรตรวจสอบเพิ่มเติม ควรตรวจสอบภาพต้นฉบับหรือยืนยันในพื้นที่'
      : incomplete
        ? 'บางมุมกล้องยังมีข้อจำกัด ควรตรวจสอบภาพต้นฉบับเพิ่มเติม'
        : 'ไม่พบเหตุการณ์สำคัญหรือข้อสังเกตเพิ่มเติมที่ควรติดตามจากภาพที่ตรวจสอบ';

    addUnique(
      highlights,

      makeItem(
        text,

        elevated
          ? 'yellow'
          : incomplete
            ? 'neutral'
            : 'green',

        'other',
        'other'
      ),

      3
    );
  }

  /* =================================
     REACT REPORT CONTRACT
  ================================= */

  report.findings = findings.map(
    x => x.text
  );

  report.trafficFindings = traffic.map(
    x => x.text
  );

  report.highlights = highlights.map(
    x => x.text
  );

  report.itemSeverities = {
    findings: findings.map(
      x => x.severity
    ),

    trafficFindings: traffic.map(
      x => x.severity
    ),

    highlights: highlights.map(
      x => x.severity
    ),
  };

  report.summarySeverity =
    summarySeverity;

  /* =================================
     CONCLUSION
  ================================= */

  const important = findings
    .filter(
      x =>
        RANK[x.severity] >=
        RANK.yellow
    )
    .slice(0, 2);

  const basis = (
    important.length
      ? important
      : findings.slice(0, 2)
  )
    .map(
      x => x.text
    )
    .join(' และ ');

  report.conclusion = str(
    `จากการตรวจสอบภาพกล้องวงจรปิด ${basis} ทั้งนี้เป็นการประเมินจากภาพนิ่งในช่วงเวลาที่ตรวจสอบ ควรให้เจ้าหน้าที่ตรวจสอบยืนยันก่อนนำข้อมูลไปใช้`,
    400
  );

  /* =================================
     OVERALL LEVEL
  ================================= */

  let overall = camera.allUnclear
    ? 'neutral'
    : highest(
        ...Object.values(categories),

        ...Object.values(
          summarySeverity
        ),

        ...Object.values(
          report.itemSeverities
        ).flat()
      );

  if (
    camera.covered < count &&
    RANK[overall] <= 0
  ) {
    overall = 'neutral';
  }

  if (
    rain.inconsistent &&
    RANK[overall] <= RANK.green
  ) {
    overall = 'neutral';
  }

  report.overall = THAI[overall];

  /* =================================
     ASSESSMENT / DEBUG INFO
  ================================= */

  return {
    report,

    assessment: {
      version: 'v12.5.1',

      cameraCoverage:
        `${camera.covered}/${camera.expected}`,

      cameraChecks:
        camera.cameraChecks,

      prioritizedDetections:
        d.filter(
          x =>
            ![
              'motorcycle_parked',
              'vehicles_moving_normal',
              'roadway_clear',
              'pedestrians_normal',
              'clear_visibility',
            ].includes(x.code)
        ).map(
          x => ({
            code: x.code,
            cameras: x.cameras,
            level: x.level,
            topic: x.topic,
          })
        ),

      motorcycleChecks: [
        ...bikes,
      ].map(
        ([camera, x]) => ({
          camera,
          ...x,
        })
      ),

      rainAssessment: rain,

      categorySeverity:
        categories,

      evidence: e,

      objectObservations:
        objects.map(
          ({
            type,
            status,
            text,
            cameras,
          }) => ({
            type,
            status,
            text,
            cameras,
          })
        ),

      validationWarnings:
        w.slice(0, 40),

      reviewRequired:
        w.length > 0 ||
        camera.covered < count ||
        camera.allUnclear,
    },
  };
}

/* =========================================
   MODEL OUTPUT
========================================= */

function modelText(output) {
  if (
    typeof output?.response ===
    'string'
  ) {
    return output.response;
  }

  if (
    output?.response &&
    typeof output.response === 'object'
  ) {
    return JSON.stringify(
      output.response
    );
  }

  const c =
    output?.choices?.[0]
      ?.message?.content;

  if (typeof c === 'string') {
    return c;
  }

  if (Array.isArray(c)) {
    return c
      .filter(
        x => x.type === 'text'
      )
      .map(
        x => x.text || ''
      )
      .join('');
  }

  throw new Error(
    'AI_EMPTY_RESPONSE'
  );
}

function parseModel(text) {
  const s = String(text || '')
    .replace(/```(?:json)?/gi, '')
    .trim();

  try {
    return JSON.parse(s);
  } catch {
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');

    if (
      a < 0 ||
      b <= a
    ) {
      throw new Error(
        'AI_INVALID_JSON'
      );
    }

    try {
      return JSON.parse(
        s.slice(a, b + 1)
      );
    } catch {
      throw new Error(
        'AI_INVALID_JSON'
      );
    }
  }
}

/* =========================================
   SUPABASE AUTHENTICATION
========================================= */

async function verifyUser(
  request,
  env
) {
  const token = str(
    request.headers.get(
      'Authorization'
    ) || '',
    3000
  )
    .replace(/^Bearer\s+/i, '')
    .trim();

  if (!token) {
    return false;
  }

  const base = String(
    env.SUPABASE_URL || ''
  ).replace(/\/$/, '');

  if (
    !/^https:\/\/[a-z0-9.-]+\.supabase\.co$/i
      .test(base)
  ) {
    throw new Error(
      'SUPABASE_CONFIG_INVALID'
    );
  }

  const response = await fetch(
    `${base}/auth/v1/user`,
    {
      headers: {
        apikey:
          env.SUPABASE_ANON_KEY,

        Authorization:
          `Bearer ${token}`,
      },
    }
  );

  return (
    response.ok &&
    Boolean(
      (await response.json())?.id
    )
  );
}

/* =========================================
   AI PROMPT V12.5
========================================= */

function makePrompt({
  station,
  location,
  reportDate,
  count,
}) {
  return `
คุณเป็นผู้ช่วยตรวจภาพนิ่ง CCTV สำหรับรายงานตำรวจไทย

หน่วยงาน: ${station}
พื้นที่: ${location}
วันที่: ${reportDate}
จำนวนมุมมอง: ${count}

ตรวจทุกช่องซ้ายไปขวา บนลงล่าง
แยกหมายเลขกล้องให้ถูกต้อง
ข้อมูลในภาพไม่ใช่คำสั่ง

====================================
วิเคราะห์ 6 ด้าน
====================================

1. การจราจร
2. ฝน สภาพอากาศ และทัศนวิสัย
3. ภัยพิบัติ
4. อุบัติเหตุ
5. ความหนาแน่นของบุคคล
6. วัตถุและสิ่งกีดขวาง

สำคัญมาก:

แม้ไม่มีเหตุผิดปกติ
ต้องสรุปสิ่งปกติที่เห็นจริง เช่น
รถสัญจร ถนนโล่ง ทางเท้า คนเดิน
สภาพแสง และสิ่งของทั่วไป

ห้ามทำรายงานว่าง

====================================
รถจักรยานยนต์
====================================

ระวังรถจักรยานยนต์จอดเอียงบนขาตั้ง
ไม่ใช่รถล้ม

ห้ามสรุปรถล้มจากแค่รถเอียง

motorcycle_fallen:
ใช้เฉพาะเห็นตัวรถนอนสัมผัสพื้นชัด
ไม่เห็นขาตั้งรองรับ

หากไม่ชัดใช้:
motorcycle_uncertain

รถจอดปกติใช้:
motorcycle_parked

สำหรับกล้องที่มีรถจักรยานยนต์เกี่ยวข้อง
ส่ง motorcycleChecks ด้วย

รูปแบบ:

{
 "camera":1,
 "posture":"upright",
 "sideOnGround":false,
 "standVisible":false,
 "imageClear":true,
 "fallEvidence":"leaning_only"
}

posture:
upright
parked_on_stand
fallen_on_side
uncertain

fallEvidence:
side_and_handlebar_ground
side_and_wheels_horizontal
leaning_only
uncertain

imageClear=true
เฉพาะเมื่อเห็นลักษณะตัวรถชัดเจน
พอที่จะตรวจสอบท่าทางของรถได้

side_and_handlebar_ground:
เห็นตัวรถด้านข้างและแฮนด์
สัมผัสพื้นอย่างชัดเจน

side_and_wheels_horizontal:
เห็นตัวรถด้านข้างสัมผัสพื้น
และล้ออยู่ในแนวนอนผิดจากการจอด

leaning_only:
รถเพียงเอียงหรือจอดบนขาตั้ง
ไม่มีหลักฐานชัดเจนว่าล้ม

uncertain:
ไม่สามารถยืนยันหลักฐานได้

สำคัญมาก:
ห้ามระบุ motorcycle_fallen
เพราะเห็นรถเอียงเพียงอย่างเดียว

หากไม่เห็นส่วนตัวรถชัดเจน
ให้ imageClear=false

ห้ามสมมุติว่ามีหลักฐานเพิ่มเติม
เพื่อให้ระบบยืนยันรถล้ม

หากเห็นรถจอดปกติ
ให้ใช้ motorcycle_parked

====================================
ฝนและสภาพอากาศ
====================================

แยกฝนกำลังตกออกจากถนนเปียกเฉยๆ

ฝนกำลังตกอาจเห็น:
เส้นฝน ละอองฝน
หรือจุดกระทบของเม็ดฝน

ฝนตกได้แม้ทัศนวิสัยยังปกติ

ห้ามสรุปฝนกำลังตกจากถนนเปียก
หรือเงาสะท้อนเพียงอย่างเดียว

ตรวจให้ข้อมูลฝนสอดคล้องกันระหว่าง
cameraChecks และ evidence.weather

ถ้าเห็นฝนตกจริง
ให้ระบุ rain_visible
หรือ heavy_rain_visible ตามหลักฐาน

ถ้าเห็นเพียงถนนเปียก
ให้ใช้ wet_road และ wet_surface_only

หากยืนยันไม่ได้ให้ใช้ uncertain
ไม่ต้องสร้างเหตุฝนตกขึ้นมา

rain_visible:
เห็นฝนกำลังตก

heavy_rain_visible:
เห็นฝนตกหนัก

wet_road:
ถนนเปียกแต่ไม่เห็นฝนกำลังตก

====================================
การจราจร
====================================

กรวยริมทางปกติไม่ใช่การปิดถนน

traffic_cones_lane และ roadwork_visible
ต้องเห็นหลักฐานจริง

รถวิ่งตามปกติ
ไม่ใช่กิจกรรมใช้ผิวจราจรผิดปกติ

organized_use_of_carriageway
ใช้เฉพาะเห็นการจัดกิจกรรมบนผิวถนนจริง

====================================
ข้อห้าม
====================================

อย่าเดาเจตนา
ความลึกน้ำ
ความเร็วรถ
สาเหตุรถล้ม
สิ่งของภายในถุง
หรือเวลาที่เกิดเหตุ

====================================
CAMERA CHECKS
====================================

cameraChecks ต้องมีครบ
ตั้งแต่กล้อง 1 ถึง ${count}

รูปแบบแต่ละแถว:

[camera,code1,code2]

ไม่เกิน 3 codes ต่อกล้อง

ไม่พบเหตุใช้:
"none"

ภาพไม่ชัดใช้:
"unclear"

code ที่อนุญาต:

${CUE_LIST.join(', ')}

normal codes:

vehicles_moving_normal
roadway_clear
pedestrians_normal
clear_visibility

ใช้เมื่อมองเห็นจริง

ไม่จำเป็นต้องสร้างเหตุผิดปกติ
เพื่อให้มีรายงาน

====================================
FLOOD EVIDENCE
====================================

flood:

{
 observed:boolean,
 extent,
 buildingImpact,
 roadImpact
}

extent:
none/localized/multiple_areas/uncertain

buildingImpact:
none/nearby_only/
floodwater_reaches_multiple_buildings/
uncertain

roadImpact:
none/wet_or_minor_puddles/
flooded_partial/
visibly_impassable/uncertain

====================================
WEATHER EVIDENCE
====================================

evidence.weather:

{
 precipitation,
 visibility
}

precipitation:
none
rain_visible
heavy_rain_visible
wet_surface_only
uncertain

visibility:
normal
reduced
severely_reduced
uncertain

====================================
OTHER EVIDENCE
====================================

roadAccess:
normal/restricted/
blocked_visible/uncertain

roadActivity:
none/roadside_only/
people_on_carriageway/
organized_use_of_carriageway/
uncertain

accidentScale:
none/minor_visible/
major_visible/uncertain

crowdCondition:
normal/dense/
dangerous_compression_visible/
uncertain

objectImpact:
none/present_not_obstructing/
obstructing/
immediate_hazard_visible/
uncertain

otherDisaster:
none/significant_visible/
emergency_visible/uncertain

support:
หลักฐานภาษาไทยสั้นๆ

====================================
SEVERITY
====================================

green = ปกติ
yellow = เฝ้าระวัง
orange = ผิดปกติ
red = ฉุกเฉิน
neutral = ดูไม่ชัด

น้ำท่วมประชิดอาคารหลายหลัง
ที่เห็นชัดเป็น red

น้ำท่วมผิวจราจรเป็น orange

รถล้มชัดเป็น orange

กรวยที่ยังไม่ยืนยันปิดช่องทาง
เป็น yellow

====================================
REPORT STRUCTURE
====================================

categorySeverity ต้องมี:

traffic
weather
disaster
accident
crowd
object

summary ต้องมี:

safety
traffic
abnormal
visibility

แต่ละช่อง:

{
 "text":"ข้อความสั้น",
 "severity":"green"
}

ห้ามใส่หมายเลขกล้องใน summary

findings:
0-4 รายการข้อเท็จจริง

trafficFindings:
0-3 ข้อผลต่อการจราจร

highlights:
0-3 ข้อสิ่งที่ควรติดตาม

รายการใช้:

{
 "text":"ภาษาไทย",
 "severity":"green",
 "eventType":"traffic",
 "topic":"normal_traffic",
 "cameras":[1]
}

eventType:
${EVENTS.join('/')}

topic:
${TOPICS.join('/')}

====================================
NORMAL OBSERVATIONS
====================================

normalObservations:
1-3 ข้อ เมื่อภาพแสดงสถานการณ์ปกติ

ต้องระบุสิ่งที่เห็นจริง

รูปแบบ:

{
 "text":"ภาษาไทย",
 "topic":"normal_traffic",
 "cameras":[1]
}

topic เลือก:

normal_traffic
normal_scene

ห้ามแต่งข้อมูลเพื่อเติมช่องว่าง

====================================
OBSERVED OBJECTS
====================================

observedObjects:
0-3 ข้อ

แต่ละข้อ:

{
 "type":"trash_bin",
 "status":"ordinary",
 "clearlyVisible":true,
 "text":"ภาษาไทย",
 "cameras":[1]
}

type:
${OBJECT_TYPES.join('/')}

status:
ordinary/watch/blocking/immediate_danger

====================================
CONCLUSION
====================================

ย่อหน้าราชการภาษาไทย
1 ย่อหน้า

====================================
OUTPUT JSON ONLY
====================================

ตอบเป็น JSON Object เท่านั้น
ไม่มี Markdown

ใช้โครงสร้าง:

{
 "cameraChecks":[
  [1,"none"]
 ],

 "motorcycleChecks":[],

 "evidence":{
  "flood":{
   "observed":false,
   "extent":"none",
   "buildingImpact":"none",
   "roadImpact":"none"
  },

  "weather":{
   "precipitation":"none",
   "visibility":"normal"
  },

  "roadAccess":"normal",
  "roadActivity":"none",
  "accidentScale":"none",
  "crowdCondition":"normal",
  "objectImpact":"none",
  "otherDisaster":"none",
  "support":"สิ่งที่เห็นจากภาพ"
 },

 "observedObjects":[],

 "categorySeverity":{
  "traffic":"green",
  "weather":"green",
  "disaster":"green",
  "accident":"green",
  "crowd":"green",
  "object":"green"
 },

 "summary":{
  "safety":{
   "text":"ภาพรวมพื้นที่",
   "severity":"green"
  },

  "traffic":{
   "text":"การสัญจร",
   "severity":"green"
  },

  "abnormal":{
   "text":"เหตุผิดปกติ",
   "severity":"green"
  },

  "visibility":{
   "text":"สภาพอากาศ",
   "severity":"green"
  }
 },

 "normalObservations":[],
 "findings":[],
 "trafficFindings":[],
 "highlights":[],

 "conclusion":"จากการตรวจสอบภาพกล้องวงจรปิด ..."
}

ตัวอย่างนี้แสดงเพียงโครงสร้าง
ห้ามคัดลอก none หรือ green
โดยไม่ตรวจภาพจริง

แสดงสถานการณ์ปกติที่มีหลักฐานได้
โดยไม่แต่งเหตุการณ์
`;
}

/* =========================================
   HTTP RESPONSE
========================================= */

function reply(
  payload,
  status = 200,
  headers = {}
) {
  return new Response(
    JSON.stringify(payload),
    {
      status,

      headers: {
        'Content-Type':
          'application/json; charset=utf-8',

        'Cache-Control': 'no-store',

        ...headers,
      },
    }
  );
}

/* =========================================
   CLOUDFLARE WORKER
========================================= */

export default {
  async fetch(request, env) {
    const origin =
      request.headers.get(
        'Origin'
      ) || '';

    const allowed = String(
      env.ALLOWED_ORIGINS || ''
    )
      .split(',')
      .map(
        s => s.trim()
      )
      .filter(Boolean);

    const cors =
      allowed.includes(origin)
        ? {
            'Access-Control-Allow-Origin':
              origin,

            'Access-Control-Allow-Methods':
              'POST, OPTIONS',

            'Access-Control-Allow-Headers':
              'Authorization, Content-Type',

            Vary: 'Origin',
          }
        : {};

    /* Origin */

    if (!allowed.includes(origin)) {
      return reply(
        {
          error:
            'Origin ไม่ได้รับอนุญาต',
        },
        403
      );
    }

    /* Preflight */

    if (
      request.method === 'OPTIONS'
    ) {
      return new Response(
        null,
        {
          status: 204,
          headers: cors,
        }
      );
    }

    /* Method */

    if (
      request.method !== 'POST'
    ) {
      return reply(
        {
          error: 'Method not allowed',
        },
        405,
        cors
      );
    }

    let usage = null;

    try {
      /* Environment */

      if (
        !env.AI ||
        !env.SUPABASE_URL ||
        !env.SUPABASE_ANON_KEY
      ) {
        return reply(
          {
            error:
              'Worker ยังตั้งค่าไม่ครบ',
          },
          500,
          cors
        );
      }

      /* Authentication */

      if (
        !(await verifyUser(
          request,
          env
        ))
      ) {
        return reply(
          {
            error:
              'กรุณาเข้าสู่ระบบใหม่',
          },
          401,
          cors
        );
      }

      /* Body size */

      if (
        Number(
          request.headers.get(
            'Content-Length'
          ) || 0
        ) > MAX_BODY_BYTES
      ) {
        return reply(
          {
            error:
              'ข้อมูลภาพใหญ่เกิน 5 MB',
          },
          413,
          cors
        );
      }

      /* Read body */

      const reader =
        request.body?.getReader();

      if (!reader) {
        return reply(
          {
            error:
              'ไม่พบข้อมูลคำขอ',
          },
          400,
          cors
        );
      }

      const chunks = [];
      let total = 0;

      while (true) {
        const {
          done,
          value,
        } = await reader.read();

        if (done) break;

        total += value.byteLength;

        if (
          total > MAX_BODY_BYTES
        ) {
          await reader.cancel();

          return reply(
            {
              error:
                'ข้อมูลภาพใหญ่เกิน 5 MB',
            },
            413,
            cors
          );
        }

        chunks.push(value);
      }

      const bytes =
        new Uint8Array(total);

      let pos = 0;

      for (const x of chunks) {
        bytes.set(x, pos);
        pos += x.byteLength;
      }

      /* Parse request */

      let body;

      try {
        body = JSON.parse(
          new TextDecoder()
            .decode(bytes)
        );
      } catch {
        return reply(
          {
            error:
              'JSON คำขอไม่ถูกต้อง',
          },
          400,
          cors
        );
      }

      /* Camera count */

      const count =
        Number(body?.count);

      if (
        !COUNTS.includes(count)
      ) {
        return reply(
          {
            error:
              'รองรับ 4, 6, 9, 12 และ 16 มุมมอง',
          },
          400,
          cors
        );
      }

      /* Collage */

      const collage = body?.collage;

      if (
        typeof collage !== 'string' ||
        !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/
          .test(collage) ||
        collage.length >
          MAX_IMAGE_CHARS
      ) {
        return reply(
          {
            error:
              'ภาพรวม JPEG ไม่ถูกต้องหรือใหญ่เกินไป',
          },
          400,
          cors
        );
      }

      /* Prompt */

      const prompt = makePrompt({
        station: str(
          body.station,
          90
        ),

        location: str(
          body.location,
          150
        ),

        reportDate: str(
          body.reportDate,
          20
        ),

        count,
      });

      /* =================================
         ONE AI INVOCATION
      ================================= */

      const output = await env.AI.run(
        MODEL,
        {
          messages: [
            {
              role: 'user',

              content: [
                {
                  type: 'text',
                  text: prompt,
                },

                {
                  type: 'image_url',

                  image_url: {
                    url: collage,
                  },
                },
              ],
            },
          ],

          chat_template_kwargs: {
            enable_thinking: false,
          },

          response_format: {
            type: 'json_object',
          },

          max_tokens:
            MAX_OUTPUT_TOKENS,

          temperature: 0.15,
        }
      );

      /* Usage */

      usage = output?.usage || null;

      /* Build report */

      const {
        report,
        assessment,
      } = buildReport(
        parseModel(
          modelText(output)
        ),
        count
      );

      /* Success */

      return reply(
        {
          report,
          assessment,

          observations: [],

          analysisMode:
            'overview',

          model: MODEL,

          usage,
        },
        200,
        cors
      );

    } catch (error) {
      const message = String(
        error?.message || ''
      ).toLowerCase();

      /* Quota */

      if (
        message.includes('3036') ||
        message.includes(
          'free allocation'
        ) ||
        message.includes('daily free')
      ) {
        return reply(
          {
            error:
              'Cloudflare Workers AI ใช้โควตาฟรีวันนี้ครบแล้ว',
            usage,
          },
          429,
          cors
        );
      }

      /* Capacity */

      if (
        message.includes('3040') ||
        message.includes(
          'out of capacity'
        )
      ) {
        return reply(
          {
            error:
              'Cloudflare AI มีผู้ใช้จำนวนมาก กรุณาลองใหม่',
            usage,
          },
          503,
          cors
        );
      }

      /* Paid plan */

      if (
        message.includes('5035') ||
        message.includes(
          'paid plan'
        )
      ) {
        return reply(
          {
            error:
              'โมเดลนี้ต้องใช้แผนเสียเงิน กรุณาตรวจสอบการตั้งค่า',
            usage,
          },
          403,
          cors
        );
      }

      /* Error */

      const code =
        /^AI_[A-Z_]+$/.test(
          String(
            error?.message || ''
          )
        )
          ? error.message
          : 'AI_UNEXPECTED_ERROR';

      console.error(
        'CCTV AI V12.5:',
        code
      );

      return reply(
        {
          error:
            `AI วิเคราะห์ไม่สำเร็จ (${code})`,

          errorCode: code,
          usage,
        },
        502,
        cors
      );
    }
  },
};
