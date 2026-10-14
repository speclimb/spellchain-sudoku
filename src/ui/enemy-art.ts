/** Inline line art keeps portraits available offline and visibly distinct. */
export function enemyEmblem(kind = 'ember'): string {
  const shapes: Record<string, string> = {
    ember: '<path d="M80 30 C105 63 113 82 97 106 C86 123 55 121 46 101 C34 78 57 66 58 47 C65 60 71 65 74 74 C84 57 75 45 80 30Z"/><path d="M77 78 C95 94 91 110 78 112 C61 110 60 96 77 78Z" class="solid"/>',
    wing: '<path d="M77 77 Q44 28 21 50 L37 100 L64 90 L80 121 L96 90 L123 100 L139 50 Q116 28 83 77Z"/><path d="M56 52 L65 83 M104 52 L95 83 M70 98 L90 98"/>',
    guardian: '<path d="M80 24 L120 47 L113 101 L80 132 L47 101 L40 47Z"/><path d="M80 45 L100 78 L80 111 L60 78Z M57 65 H103 M55 91 H105"/>',
    eye: '<path d="M20 80 Q80 14 140 80 Q80 146 20 80Z"/><circle cx="80" cy="80" r="26"/><path d="M80 58 L91 80 L80 102 L69 80Z" class="solid"/><path d="M80 24 V12 M80 148 V136"/>',
    star: '<path d="M80 17 L95 60 L140 55 L110 88 L128 132 L83 113 L46 140 L50 97 L17 71 L62 62Z"/><circle cx="80" cy="83" r="18"/><path d="M77 55 L89 88 L64 100"/>',
    dragon: '<path d="M80 122 L47 96 L36 42 L64 56 L80 23 L96 56 L124 42 L113 96Z"/><path d="M38 70 L13 49 L26 104 L59 114 M122 70 L147 49 L134 104 L101 114 M62 77 L74 85 M98 77 L86 85 M70 103 L80 110 L90 103"/><path d="M80 47 L86 65 L80 77 L74 65Z" class="solid"/>',
    frost: '<path d="M45 76 35 31 65 51 80 42 97 51 125 31 115 78 103 105 80 130 57 105Z"/><path d="M48 68 63 73 67 87 54 80 M112 68 97 73 93 87 106 80 M65 98 80 90 95 98 80 109Z"/><path d="M69 107 71 121 78 111 M91 107 89 121 82 111 M80 19V34 M72 24 88 30 M72 30 88 24" class="solid"/>',
    mirror: '<path d="M57 45 65 27 80 37 95 27 103 45 M51 58 26 46 M46 80 20 80 M50 103 29 121 M109 58 134 46 M114 80 140 80 M110 103 131 121"/><path d="M80 43 C36 43 34 110 80 131 C126 110 124 43 80 43Z"/><path d="M80 45V130 M54 62 80 53 106 62 110 97 80 119 50 97Z M54 62 80 83 106 62 M50 97 80 83 110 97"/><path d="M61 66 70 64 59 84Z M90 90 102 85 96 103Z" class="solid"/>',
  };
  return `<svg class="enemy-emblem" data-enemy-art="${kind in shapes ? kind : 'ember'}" viewBox="0 0 160 160" aria-hidden="true"><circle cx="80" cy="80" r="73" class="orbit"/><circle cx="80" cy="80" r="62" class="orbit faint"/>${shapes[kind] ?? shapes.ember}<path d="M80 3 V9 M80 151 V157 M3 80 H9 M151 80 H157" class="orbit"/></svg>`;
}
