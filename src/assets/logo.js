import { svg } from 'lit'

/**
 * FlowCrafter logo icon as Lit svg template.
 * @param {number} size
 */
export const logoIcon = (size = 32) => svg`
    <svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="fcbg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#6366f1"/>
                <stop offset="100%" stop-color="#8b5cf6"/>
            </linearGradient>
        </defs>
        <rect width="32" height="32" rx="7" fill="url(#fcbg)"/>
        <circle cx="7" cy="23" r="3.5" fill="white"/>
        <circle cx="25" cy="9" r="3.5" fill="white"/>
        <path d="M10.2 21.5 C 14 21.5 18 10.5 20.5 10" stroke="white" stroke-width="2" stroke-opacity="0.55" fill="none" stroke-linecap="round"/>
        <path d="M19.5 8 L22.5 10 L20 12.5" stroke="white" stroke-width="1.8" stroke-opacity="0.95" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
`
