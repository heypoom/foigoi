import {useState} from 'react'
import {automator} from '../utils/exhibition/exhibition-automator'
import {resetAll} from '../utils/exhibition/reset'
import {SCREENING_END_TIME} from '../constants/exhibition-cues'
import {Icon} from '@iconify/react'

// Convert hh:mm:ss to total seconds
function timeToSeconds(time: string): number {
  const [hours, minutes, seconds] = time.split(':').map(Number)
  return hours * 3600 + minutes * 60 + seconds
}

// Convert seconds to hh:mm:ss
function secondsToTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

// Add seconds to a time string (hh:mm:ss + seconds = hh:mm:ss)
function addSecondsToTime(time: string, seconds: number): string {
  const timeSeconds = timeToSeconds(time)
  const totalSeconds = timeSeconds + seconds
  return secondsToTime(totalSeconds)
}

export function DebugTimeSlider() {
  const [showTimeSlider, setShowTimeSlider] = useState(false)

  // Calculate slider range - use absolute times
  const exhibitionStartTime = '10:00:00' // First exhibition run starts at 10:00:00
  const screeningDurationSeconds = timeToSeconds(SCREENING_END_TIME) // Duration of one screening
  const exhibitionEndTime = addSecondsToTime(
    exhibitionStartTime,
    screeningDurationSeconds
  ) // 11:00:00 + 01:14:00 = 12:14:00

  const startSeconds = 0 // Start at 0 seconds from exhibition start
  const endSeconds = screeningDurationSeconds // End at screening duration
  const [sliderValue, setSliderValue] = useState(0)

  function setFakeExhibitionOpenTime(time: string) {
    console.log(`setting fake time to ${time}`)

    resetAll()
    automator.mockTime(time)
    automator.sync({force: true})
  }

  // Handle time slider change
  function handleTimeSliderChange(event: React.ChangeEvent<HTMLInputElement>) {
    const durationSeconds = parseInt(event.target.value)
    setSliderValue(durationSeconds)
    // Convert duration from start to absolute time
    const absoluteTime = addSecondsToTime(exhibitionStartTime, durationSeconds)
    setFakeExhibitionOpenTime(absoluteTime)
  }

  // Get current absolute time for display
  function getCurrentAbsoluteTime(): string {
    return addSecondsToTime(exhibitionStartTime, sliderValue)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowTimeSlider(!showTimeSlider)}
        className="bg-[#2d2d30] text-white leading-3 p-[3px] w-[50px] h-[50px] rounded-full text-xs flex items-center justify-center z-100000 focus:outline-none focus:ring focus:ring-violet-300 focus:bg-violet-500 hover:bg-violet-500 bg-opacity-50"
        title="Debug time slider"
        aria-label="Open debug time slider"
      >
        <Icon icon="lucide:clock" fontSize={30} />
      </button>

      {showTimeSlider && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[1000001] w-full max-w-md bg-gray-900 border border-gray-600 rounded p-3 shadow-lg">
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-sm text-gray-400">
              <span>Debug Time Slider</span>
              <button
                type="button"
                onClick={() => setShowTimeSlider(false)}
                className="text-gray-500 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <input
                type="range"
                min={startSeconds}
                max={endSeconds}
                value={sliderValue}
                onChange={handleTimeSliderChange}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                aria-label="Exhibition time slider"
                title={`Seek to ${getCurrentAbsoluteTime()}`}
                style={{
                  background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${
                    ((sliderValue - startSeconds) /
                      (endSeconds - startSeconds)) *
                    100
                  }%, #374151 ${
                    ((sliderValue - startSeconds) /
                      (endSeconds - startSeconds)) *
                    100
                  }%, #374151 100%)`,
                }}
              />

              <div className="flex justify-between text-xs text-gray-500">
                <span>{exhibitionStartTime}</span>
                <span className="text-blue-400">
                  {getCurrentAbsoluteTime()}
                </span>
                <span>{exhibitionEndTime}</span>
              </div>
            </div>

            <div className="text-xs text-gray-400">
              Slide to seek to any time in the exhibition timeline (
              {exhibitionStartTime} to {exhibitionEndTime})
            </div>
          </div>
        </div>
      )}
    </>
  )
}
