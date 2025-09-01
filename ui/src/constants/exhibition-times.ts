// The video is 74 minutes, which is 74 * 60 seconds.
export const SCREENING_DURATION = 74 * 60 * 1000

/**
 * The exhibition runs from 10am to 10pm.
 * The video restarts every 75 minutes.
 * The video itself is 74 minutes long, followed by a 1-minute countdown.
 *
 * This means the video will restart at 10:00 (opening time), 11:15, 12:30, 13:45, 15:00,
 * 16:15, 17:30, 18:45, 20:00, and 21:15.
 * The last screening starts at 21:15, and the exhibition closes at 22:00.
 */
export function getExhibitionTimes() {
  const EXHIBITION_TIMES: string[] = [
    '10:00',
    '11:15',
    '12:30',
    '13:45',
    '15:00',
    '16:15',
    '17:30',
    '18:45',
    '20:00',
    '21:15',
  ]

  return EXHIBITION_TIMES
}
