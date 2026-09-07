import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State { error: Error | null; stack: string }

/** Shows a readable error instead of a blank page when a route crashes while rendering. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, stack: '' }
  static getDerivedStateFromError(error: Error): Partial<State> { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { this.setState({ stack: info.componentStack ?? '' }); console.error('Route crashed:', error, info.componentStack) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto mt-8 max-w-2xl rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-900">
        <h2 className="font-display text-lg font-bold">Something went wrong on this page</h2>
        <p className="mt-1">Please send this message to the fleet administrator:</p>
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded bg-white p-3 font-mono text-xs text-red-800">{this.state.error.message}{'\n'}{this.state.stack.split('\n').slice(0, 6).join('\n')}</pre>
        <button onClick={() => { this.setState({ error: null, stack: '' }); window.location.hash = '#/' }} className="mt-3 rounded-md bg-brand-purple px-3 py-1.5 text-white">Back to start</button>
      </div>
    )
  }
}
