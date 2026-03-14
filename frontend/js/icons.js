export const icons = {
  logoHat: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M7.4 13.4V20h9.2v-6.6m-9.2 0H6.8a4.4 4.4 0 1 1 1.3-8.6A4.8 4.8 0 0 1 12 2.7a4.8 4.8 0 0 1 3.9 2.1 4.4 4.4 0 1 1 1.3 8.6h-.6m-9.2 0h9.2"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  `, 
  chefHat: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7 10a3.5 3.5 0 0 1 3-5.8A4.5 4.5 0 0 1 18.8 6 3.2 3.2 0 0 1 19 12H7a2 2 0 0 1 0-4Z" fill="currentColor"/>
      <path d="M8 12h8v6a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-6Z" fill="currentColor" opacity="0.82"/>
    </svg>
  `,
  speaker: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 10h4l5-4v12l-5-4H5z" fill="currentColor"/>
      <path d="M17 9a4 4 0 0 1 0 6M18.8 6.8a7 7 0 0 1 0 10.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
  `,
  mute: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 10h4l5-4v12l-5-4H5z" fill="currentColor"/>
      <path d="m17 9 4 6M21 9l-4 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
  `,
  trash: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 4h6l1 2h4v2H4V6h4l1-2Zm1 6h2v7h-2v-7Zm4 0h2v7h-2v-7ZM7 8h10l-.8 10.2A2 2 0 0 1 14.2 20H9.8a2 2 0 0 1-2-1.8L7 8Z" fill="currentColor"/>
    </svg>
  `,
  servings: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 12a7 7 0 0 1 14 0v5H5v-5Zm2 7h10v1H7v-1Z" fill="currentColor"/>
      <circle cx="12" cy="10" r="2.2" fill="currentColor" opacity="0.72"/>
    </svg>
  `,
  timer: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 3h6v2H9V3Zm3 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm0 3v4l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `,
  flame: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M13.2 2.5c.5 2-1 3.7-2.1 5-.9 1.1-1.5 2-1.5 3.4 0 1.8 1.4 3.1 3.1 3.1 2.8 0 4.4-3 3.3-5.5 2.3 1.4 3.8 4 3.8 6.7A7.8 7.8 0 0 1 12 23a7 7 0 0 1-7.2-7c0-4.1 2.6-6.6 5-9 .9-.9 2.2-2.2 3.4-4.5Z" fill="currentColor"/>
    </svg>
  `,
  globe: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/>
      <path d="M3.5 12h17M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18" fill="none" stroke="currentColor" stroke-width="1.4"/>
    </svg>
  `,
  warning: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 4 3.5 19h17L12 4Zm0 5.3v4.9m0 3h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `,
};

export function icon(name, className = "icon") {
  return `<span class="${className}" aria-hidden="true">${icons[name] || ""}</span>`;
}
