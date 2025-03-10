import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AsyncThrottler } from '../src/async-throttler'

describe('AsyncThrottler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('should execute immediately on first call', async () => {
    const mockFn = vi.fn().mockResolvedValue(undefined)
    const throttler = new AsyncThrottler(mockFn, { wait: 100 })

    await throttler.throttle()
    expect(mockFn).toHaveBeenCalledTimes(1)
  })

  it('should not execute more than once within the wait period', async () => {
    const mockFn = vi.fn().mockResolvedValue(undefined)
    const throttler = new AsyncThrottler(mockFn, { wait: 100 })

    // First call executes immediately
    const promise1 = throttler.throttle('first')
    expect(mockFn).toHaveBeenCalledTimes(1)
    expect(mockFn).toHaveBeenLastCalledWith('first')
    await promise1

    // Make multiple calls within the wait period
    throttler.throttle('second')
    throttler.throttle('third')

    // Verify no additional executions occurred
    expect(mockFn).toHaveBeenCalledTimes(1)
    expect(mockFn).toHaveBeenLastCalledWith('first')

    // Advance time to just before wait period ends
    vi.advanceTimersByTime(99)
    await Promise.resolve()

    // Should still be at one execution
    expect(mockFn).toHaveBeenCalledTimes(1)
    expect(mockFn).toHaveBeenLastCalledWith('first')
  })

  it('should handle long-running functions that exceed wait period', async () => {
    const wait = 1000
    let resolveFirst: (value: unknown) => void
    const firstCall = new Promise((resolve) => {
      resolveFirst = resolve
    })

    const mockFn = vi.fn().mockImplementation(() => firstCall)
    const throttler = new AsyncThrottler(mockFn, { wait })

    // Start first long-running call
    const promise1 = throttler.throttle(1)
    throttler.throttle(2)
    const promise3 = throttler.throttle(3)

    // First call should be executing
    expect(mockFn).toHaveBeenCalledTimes(1)
    expect(mockFn).toHaveBeenLastCalledWith(1)

    // Complete first long-running call
    resolveFirst!({})
    await promise1

    // Wait for throttle period after first call completes
    vi.advanceTimersByTime(wait)
    await promise3

    // Should have executed with latest args
    expect(mockFn).toHaveBeenCalledTimes(2)
    expect(mockFn).toHaveBeenLastCalledWith(3)
  })

  it('should handle special timing cases with delayed calls', async () => {
    const mockFn = vi.fn().mockResolvedValue(undefined)
    const throttler = new AsyncThrottler(mockFn, { wait: 100 })

    // Initial call
    const promise1 = throttler.throttle(1)
    throttler.throttle(2)

    // First call should execute immediately
    expect(mockFn).toHaveBeenCalledTimes(1)
    expect(mockFn).toHaveBeenLastCalledWith(1)
    await promise1

    // Small delay then another call
    vi.advanceTimersByTime(35)
    throttler.throttle(3)

    // Another small delay and final call
    vi.advanceTimersByTime(35)
    const finalPromise = throttler.throttle(4)

    // Advance to complete the throttle period
    vi.advanceTimersByTime(100)
    await finalPromise

    expect(mockFn).toHaveBeenCalledTimes(2)
    expect(mockFn).toHaveBeenLastCalledWith(4)
  })

  it('should execute with latest args after wait period', async () => {
    const mockFn = vi.fn().mockResolvedValue(undefined)
    const throttler = new AsyncThrottler(mockFn, { wait: 100 })

    await throttler.throttle('first')
    expect(mockFn).toHaveBeenCalledWith('first')

    // These calls should be throttled
    const promise = throttler.throttle('second')

    vi.advanceTimersByTime(100)
    await promise

    expect(mockFn).toHaveBeenCalledTimes(2)
    expect(mockFn).toHaveBeenLastCalledWith('second')
  })

  it('should track execution count correctly', async () => {
    const mockFn = vi.fn().mockResolvedValue(undefined)
    const throttler = new AsyncThrottler(mockFn, { wait: 100 })

    await throttler.throttle()
    expect(throttler.getExecutionCount()).toBe(1)

    const promise = throttler.throttle()
    expect(throttler.getExecutionCount()).toBe(1)

    vi.advanceTimersByTime(100)
    await promise
    expect(throttler.getExecutionCount()).toBe(2)
  })

  it('should handle errors with onError callback', async () => {
    const error = new Error('Test error')
    const mockFn = vi.fn().mockRejectedValue(error)
    const onError = vi.fn()
    const throttler = new AsyncThrottler(mockFn, { wait: 100, onError })

    await throttler.throttle()
    expect(onError).toHaveBeenCalledWith(error)
  })

  it('should ignore errors in onError callback', async () => {
    const error = new Error('Test error')
    const mockFn = vi.fn().mockRejectedValue(error)
    const onError = vi.fn().mockImplementation(() => {
      throw new Error('Error handler error')
    })
    const throttler = new AsyncThrottler(mockFn, { wait: 100, onError })

    // Should not throw
    await expect(throttler.throttle()).resolves.not.toThrow()
  })

  it('should continue processing after function throws error', async () => {
    const mockFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('First call error'))
      .mockResolvedValueOnce(undefined)
    const throttler = new AsyncThrottler(mockFn, { wait: 100 })

    // First call throws
    await throttler.throttle(1)

    // Second call should still execute after wait period
    const promise = throttler.throttle(2)
    vi.advanceTimersByTime(100)
    await promise

    expect(mockFn).toHaveBeenCalledTimes(2)
    expect(mockFn).toHaveBeenLastCalledWith(2)
  })

  it('should wait for execution to complete before starting next one', async () => {
    let resolveFirst: (value: unknown) => void
    const firstCall = new Promise((resolve) => {
      resolveFirst = resolve
    })

    const mockFn = vi.fn().mockImplementation(() => firstCall)
    const throttler = new AsyncThrottler(mockFn, { wait: 100 })

    const promise1 = throttler.throttle('first')
    const promise2 = throttler.throttle('second')

    expect(mockFn).toHaveBeenCalledTimes(1)
    expect(mockFn).toHaveBeenCalledWith('first')

    resolveFirst!({})
    await promise1

    vi.advanceTimersByTime(100)
    await promise2

    expect(mockFn).toHaveBeenCalledTimes(2)
    expect(mockFn).toHaveBeenLastCalledWith('second')
  })

  it('should maintain proper timing between executions', async () => {
    const mockFn = vi.fn().mockResolvedValue(undefined)
    const throttler = new AsyncThrottler(mockFn, { wait: 100 })

    await throttler.throttle('a')
    expect(mockFn).toHaveBeenCalledTimes(1)
    expect(mockFn).toHaveBeenLastCalledWith('a')

    // Should be throttled
    const promise = throttler.throttle('b')
    expect(mockFn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(100)
    await promise
    expect(mockFn).toHaveBeenCalledTimes(2)
    expect(mockFn).toHaveBeenLastCalledWith('b')

    // Should execute immediately after wait period
    vi.advanceTimersByTime(100)
    await throttler.throttle('c')
    expect(mockFn).toHaveBeenCalledTimes(3)
    expect(mockFn).toHaveBeenLastCalledWith('c')
  })

  it('should update nextExecutionTime after each execution', async () => {
    const mockFn = vi.fn().mockResolvedValue(undefined)
    const throttler = new AsyncThrottler(mockFn, { wait: 100 })

    const now = Date.now()
    await throttler.throttle()

    expect(throttler.getNextExecutionTime()).toBe(now + 100)

    vi.advanceTimersByTime(100)
    await throttler.throttle()

    expect(throttler.getNextExecutionTime()).toBe(now + 200)
  })
})
