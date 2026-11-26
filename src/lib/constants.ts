export const YARD_LOCATIONS = [
  {
    name: "Pick-A-Part Stafford",
    coords: [38.4526, -77.4116] as [number, number],
    url: "https://pickapartva.com/inventory/",
    type: "pick-a-part"
  },
  {
    name: "Pick-A-Part Fredericksburg",
    coords: [38.2861, -77.4429] as [number, number],
    url: "https://pickapartva.com/inventory/",
    type: "pick-a-part"
  },
  {
    name: "Rupert's U-Pull It",
    coords: [38.2825, -77.5367] as [number, number],
    url: "https://rupertsupullit.com/search-our-inventory/",
    type: "ruperts"
  }
];

export const MAP_CENTER = [38.3693, -77.4728] as [number, number]; // Center between Stafford and Fredericksburg

/**
 * A positive finite number from an environment value, else the fallback.
 * Goals divide progress, so zero and negative values are rejected.
 */
export function envNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Store goals. The defaults are round example values; a store sets its real
// goals in .env.local. NEXT_PUBLIC_* values are inlined at build time, so a
// change needs a rebuild.
export const PHASE_3_TARGETS = {
  REVENUE: envNumber(process.env.NEXT_PUBLIC_TARGET_REVENUE, 10000),
  ASP: 100,
  NICHE_AUTHORITY: 0.25,
  GLOBAL_REACH: envNumber(process.env.NEXT_PUBLIC_TARGET_INTERNATIONAL_SHARE, 0.10),
  SALES: 100
};

export const VOLVO_CATEGORIES = [
  {
    id: 'xc90',
    name: 'XC90 (2003-2014)',
    systems: [
      {
        id: 'elec',
        name: 'Electrical & Sensors',
        components: ['Audio Amplifier', 'Climate Control Module', 'Parking Sensor', 'Central Electronic Module']
      },
      {
        id: 'susp',
        name: 'Suspension & Steering',
        components: ['Power Steering Pump', 'Control Arm', 'Strut Assembly', 'Steering Rack']
      },
      {
        id: 'int',
        name: 'Interior Trim',
        components: ['Center Console', 'Door Panel', 'Seat Switch', 'Glove Box']
      }
    ]
  },
  {
    id: 's60-v60',
    name: 'S60/V60 (2011-2018)',
    systems: [
      {
        id: 'elec',
        name: 'Electrical & Sensors',
        components: ['BLIS Camera', 'Infotainment Screen', 'Body Control Module', 'Alternator']
      },
      {
        id: 'susp',
        name: 'Suspension & Steering',
        components: ['Active Chassis Strut', 'Wheel Hub', 'Tie Rod End', 'Sway Bar Link']
      },
      {
        id: 'int',
        name: 'Interior Trim',
        components: ['Leather Steering Wheel', 'Shifter Assembly', 'Sun Visor', 'Floor Mats']
      }
    ]
  },
  {
    id: 'xc60',
    name: 'XC60 (2009-2017)',
    systems: [
      {
        id: 'elec',
        name: 'Electrical & Sensors',
        components: ['Power Liftgate Motor', 'HID Headlight Ballast', 'ABS Module', 'Rain Sensor']
      },
      {
        id: 'susp',
        name: 'Suspension & Steering',
        components: ['Air Suspension Compressor', 'Rear Shock', 'Lower Control Arm', 'Wheel Bearing']
      },
      {
        id: 'int',
        name: 'Interior Trim',
        components: ['Cargo Cover', 'Cupholder', 'Door Mirror Switch', 'Headrest']
      }
    ]
  },
  {
    id: 'p2',
    name: 'P2 Platform (2001-2009)',
    systems: [
      {
        id: 'elec',
        name: 'Electrical & Sensors',
        components: ['Throttle Body (ETM)', 'DIM (Instrument Cluster)', 'Fuel Pump Driver Module', 'Mass Air Flow Sensor']
      },
      {
        id: 'susp',
        name: 'Suspension & Steering',
        components: ['Subframe Bushing', 'Strut Mount', 'Lower Ball Joint', 'Power Steering Reservoir']
      },
      {
        id: 'int',
        name: 'Interior Trim',
        components: ['Shift Knob', 'Emergency Brake Boot', 'Armrest Cover', 'Rear View Mirror']
      }
    ]
  }
];

export const CONDITION_GRADES = [
  { id: 'A+', name: 'A+ (Mint/Like New)' },
  { id: 'A', name: 'A (Excellent/Minor Wear)' },
  { id: 'B', name: 'B (Good/Standard Wear)' }
];
