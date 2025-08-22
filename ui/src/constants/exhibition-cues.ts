import {ProgramId} from '../manager/socket'
import {GladiaWord} from '../types/gladia-transcript'

export const PROGRAM_ZERO_START_TIME = '00:06:47'
export const PROGRAM_ZERO_END_TIME = '00:34:24'
export const SCREENING_END_TIME = '01:13:00'

export const FADE_IN_TIME = '00:06:45'
export const FADE_OUT_TIME = '01:12:15'

export type AutomationAction =
  | {action: 'start'} // start the program
  | {action: 'next'} // go to the next program
  | {
      action: 'transcript'
      transcript: string

      when?: [number, number]
      words?: GladiaWord[]
      generate?: boolean
    } // add transcript
  | {action: 'set-fade-status'; fade: boolean} // set the fade-to-black status
  | {action: 'navigate'; route: string} // navigate to a route
  | {
      action: 'prompt'
      prompt: string
      override?: string
      delay?: {base?: number; variance?: number}
      program: ProgramId
      enter?: {regen: boolean}
      commit?: boolean
      guidance?: number
      inferenceStep?: number
      fixedDelayPerStep?: number
    } // clear, type, and enter prompt
  | {
      action: 'move-slider'
      program: string
      value: number
      inferenceStep?: number
      fixedDelayPerStep?: number
    } // slowly move the guidance slider
  | {action: 'reconnect'} // disable regen and reconnect
  | {action: 'end'} // end the showing

export type AutomationCue = AutomationAction & {time: string}

// Must be sorted by time with the transcription cues before use.
export const PROGRAM_CUES: AutomationCue[] = [
  // we start at 00:00:00
  {time: '00:00:00', action: 'start'},

  // reconnect to the server a few seconds before the start of the program
  {time: '00:06:43', action: 'reconnect'},

  // fade in program zero
  {time: FADE_IN_TIME, action: 'navigate', route: '/zero'},
  {time: PROGRAM_ZERO_START_TIME, action: 'set-fade-status', fade: false},

  // fade to black, prepare to go to program 1
  {time: PROGRAM_ZERO_END_TIME, action: 'next'},

  // start program 1
  {time: '00:36:05', action: 'next'},

  // start program 2
  {time: '00:44:14', action: 'navigate', route: '/two'},

  // type prompt
  {
    time: '00:44:24',
    action: 'prompt',
    program: 'P2',
    prompt: 'painting like epic poem of malaya',
    commit: true,
    guidance: 40,
    inferenceStep: 17,
    fixedDelayPerStep: 750, // 17 steps * 750 ms = 12.75 seconds
  },

  // slide to 0%
  {
    time: '00:44:53',
    action: 'move-slider',
    value: 0,
    program: 'P2',
    inferenceStep: 1,
    fixedDelayPerStep: 500, // 1 step * 500ms = 0.5 seconds
  },

  // slide to 70%
  {
    time: '00:45:25',
    action: 'move-slider',
    value: 70,
    program: 'P2',
    inferenceStep: 29,

    // cue goes from 00:45:25 to 00:46:00 = 35 seconds
    fixedDelayPerStep: 1100, // 29 steps * 1100ms = 31.9 seconds
  },

  // start program 2B
  // {time: '00:43:30', action: 'navigate', route: '/two-b'},

  // type prompt
  // {
  //   time: '00:43:35',
  //   action: 'prompt',
  //   program: 'P2B',
  //   prompt: 'painting like epic poem of malaya but with more people',
  //   guidance: 60,
  //   inferenceStep: 29,
  // },

  // start program 3B
  {time: '00:46:05', action: 'navigate', route: '/three-b'},

  // erase prompt
  {
    time: '00:46:06',
    action: 'prompt',
    prompt: '',
    delay: {base: 30, variance: 20},
    commit: false,
    program: 'P3B',
  },

  // type prompt
  {
    time: '00:46:08',
    action: 'prompt',
    program: 'P3B',
    prompt: 'chua mia tee painting',
    enter: {regen: true},

    // 00:46:08 -> 00:46:25 is 17 seconds
    inferenceStep: 50,
    fixedDelayPerStep: 340,
  },

  // start program 4
  {time: '00:54:23', action: 'navigate', route: '/four'},

  // type prompt
  {
    time: '00:54:30',
    action: 'prompt',
    program: 'P4',
    prompt: 'data researcher',
    override: 'person, data researcher, photorealistic',
    enter: {regen: false},
  },

  // type prompt
  {
    time: '00:54:59',
    action: 'prompt',
    program: 'P4',
    prompt: 'crowdworker',
    enter: {regen: false},
  },

  // reconnect to the server a few seconds before the start of the program
  {time: '00:55:39', action: 'reconnect'},

  // start program 4B
  {time: '00:55:41', action: 'navigate', route: '/four-b'},

  // type prompt
  {
    time: '00:55:46',
    action: 'prompt',
    program: 'P4',
    prompt: 'big tech ceo',
    enter: {regen: true},
  },

  // type prompt
  {
    time: '01:10:20',
    action: 'prompt',
    program: 'P4',
    prompt: 'stable diffusion',
    enter: {regen: true},
  },

  // cleanup before the screening ends
  {
    time: '01:12:10',
    action: 'reconnect',
  },

  // fade to black
  {
    time: FADE_OUT_TIME,
    action: 'set-fade-status',
    fade: true,
  },

  {
    time: SCREENING_END_TIME,
    action: 'end',
  },
]
