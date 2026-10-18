/** Example devices. Dates are a plan, not a live reading. */

export const DEVICES = [
  {
    id: "laptop",
    kind: "Laptop",
    name: "ThinkPad X1 Carbon Gen 11",
    status: "Watch",
    summary: "Battery is still healthy. Refresh the laptop in 2028, before the warranty is a distant memory.",
    serial: "PF-4X1C82",
    purchased: "2024-03-12",
    warranty: "Premier Support through Mar 12, 2027",
    url: "https://pcsupport.lenovo.com/",
    specs: [
      ["Processor", "Intel Core Ultra 7 155H"],
      ["Memory", "32 GB LPDDR5X"],
      ["Storage", "1 TB SSD · 98% health"],
      ["Display", "14 in 2.8K OLED"],
      ["Battery", "86% capacity · 412 cycles"],
      ["BIOS", "1.28"],
    ],
    replacements: [
      {
        part: "Battery",
        when: "2027-11-01",
        note: "Swap near 800 cycles, or sooner if capacity falls under 80%.",
      },
      {
        part: "Laptop",
        when: "2028-03-12",
        note: "Four-year refresh. Support ends the year before.",
      },
    ],
  },
  {
    id: "phone",
    kind: "Phone",
    name: "Pixel 8",
    status: "Good",
    summary: "Security updates run through 2030. The battery is the reason to replace it sooner.",
    serial: "GA04821-PX8",
    purchased: "2023-10-12",
    warranty: "Ended Oct 12, 2024",
    url: "https://store.google.com/magazine/repaircenter",
    specs: [
      ["Storage", "128 GB"],
      ["OS", "Android 15"],
      ["Battery", "91% capacity · 640 cycles"],
      ["Display", "6.2 in OLED, intact"],
      ["Updates", "Security patches through Oct 2030"],
      ["Radios", "Unlocked"],
    ],
    replacements: [
      {
        part: "Battery",
        when: "2027-04-01",
        note: "Capacity usually gets annoying around year four. A battery service beats a new phone.",
      },
      {
        part: "Phone",
        when: "2027-10-12",
        note: "Four-year refresh if the battery service is not worth it.",
      },
    ],
  },
  {
    id: "tablet",
    kind: "Tablet",
    name: "iPad Air 11-inch (M2)",
    status: "Good",
    summary: "AppleCare covers it through summer. The battery still has plenty of room.",
    serial: "DMPX7K3L1A",
    purchased: "2025-08-18",
    warranty: "AppleCare+ through Aug 18, 2027",
    url: "https://support.apple.com/ipad",
    specs: [
      ["Chip", "Apple M2"],
      ["Storage", "256 GB"],
      ["OS", "iPadOS 18"],
      ["Display", "11 in Liquid Retina"],
      ["Battery", "94% capacity"],
      ["Pencil", "Paired, tip in good shape"],
    ],
    replacements: [
      {
        part: "AppleCare",
        when: "2027-08-18",
        note: "Decide whether to renew before the plan lapses.",
      },
      {
        part: "Tablet",
        when: "2030-08-18",
        note: "Five-year refresh. No need to replace it with the laptop.",
      },
    ],
  },
  {
    id: "monitor",
    kind: "Monitor",
    name: "Dell UltraSharp U2723QE",
    status: "Good",
    summary: "Panel hours are low. The backlight, not the warranty, sets the replacement date.",
    serial: "CN-0U2723-QE",
    purchased: "2024-01-20",
    warranty: "3-year Advanced Exchange through Jan 20, 2027",
    url: "https://www.dell.com/support/home",
    specs: [
      ["Panel", "27 in 4K IPS"],
      ["Refresh", "60 Hz"],
      ["Ports", "USB-C 90 W, HDMI, DisplayPort"],
      ["Hours", "2,140"],
      ["Stand", "Height, tilt, pivot"],
      ["Color", "Factory calibrated"],
    ],
    replacements: [
      {
        part: "Warranty",
        when: "2027-01-20",
        note: "After this, repairs are out of pocket. The panel should still be fine.",
      },
      {
        part: "Monitor",
        when: "2031-01-20",
        note: "Plan on about seven years before backlight wear.",
      },
    ],
  },
  {
    id: "headphones",
    kind: "Headphones",
    name: "Sony WH-1000XM5",
    status: "Replace",
    summary: "The ear pads are worn through. Replace those now and keep the headset until the battery gives up.",
    serial: "WH1000XM5-4491",
    purchased: "2023-06-02",
    warranty: "Ended Jun 2, 2024",
    url: "https://www.sony.com/electronics/support",
    specs: [
      ["Drivers", "30 mm"],
      ["Battery", "78% capacity · about 22 hours"],
      ["Noise canceling", "Working"],
      ["Pads", "Compressed and splitting"],
      ["Case", "Intact"],
      ["Firmware", "2.1.0"],
    ],
    replacements: [
      {
        part: "Ear pads",
        when: "2026-11-01",
        note: "A pad kit is the fix. Do this before buying another headset.",
      },
      {
        part: "Headset",
        when: "2027-06-01",
        note: "Replace when listening time drops under a workday.",
      },
    ],
  },
  {
    id: "router",
    kind: "Router",
    name: "ASUS RT-AX86U",
    status: "Watch",
    summary: "Firmware is current. Replace it when security updates stop, or when you need Wi-Fi 7.",
    serial: "RTAX86U-18K2",
    purchased: "2022-01-15",
    warranty: "Ended Jan 15, 2025",
    url: "https://www.asus.com/support/",
    specs: [
      ["Wi-Fi", "Wi-Fi 6 (802.11ax)"],
      ["Firmware", "3.0.0.4.388_24328"],
      ["WAN", "2.5 GbE"],
      ["Clients", "18 devices"],
      ["Guest network", "On, isolated"],
      ["Updates", "Security builds expected through Jan 2027"],
    ],
    replacements: [
      {
        part: "Firmware support",
        when: "2027-01-15",
        note: "Once updates stop, the router is the weak point on the network.",
      },
      {
        part: "Router",
        when: "2027-01-15",
        note: "Move to Wi-Fi 7 at the same time if the laptop and phone can use it.",
      },
    ],
  },
];

export function nextReplacement(device) {
  return [...device.replacements].sort((a, b) => a.when.localeCompare(b.when))[0];
}

export function fleetSnapshot(devices) {
  const upcoming = devices
    .flatMap((device) => device.replacements.map((item) => ({ device, item })))
    .sort((a, b) => a.item.when.localeCompare(b.item.when));
  const counts = { Good: 0, Watch: 0, Replace: 0 };
  for (const device of devices) counts[device.status] += 1;
  return { upcoming: upcoming[0], counts };
}
