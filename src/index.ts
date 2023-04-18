type ErrorParamType = Error | undefined
type LoggingLevelType = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

const DEFAULT_STORAGE_KEY = 'logs'

interface LogifyPropsType<ErrorGenericType> {
  endpoint: string
  defaultParams?: (() => Record<string, unknown>) | Record<string, unknown>
  parseError?: (error: ErrorGenericType | ErrorParamType) => Record<string, unknown> | undefined
  shouldSendLogsIf?: (() => boolean) | boolean
  shouldLogToConsoleIf?: (() => boolean) | boolean
  printColors?: {
    debug?: string
    info?: string
    warn?: string
    error?: string
    fatal?: string
  }
  storage?: {
    key?: string
    getItem: (key: string) => string | null | Promise<string | null>
    setItem: (key: string, value: string) => any
  }
}

export function isString(value: unknown): boolean {
  return typeof value === 'string'
}

export function isNumber(value: unknown): boolean {
  return typeof value === 'number'
}

export function isObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null
}

export function isFunction(value: unknown): boolean {
  return !!(value && {}.toString.call(value) === '[object Function]')
}

export function isBoolean(value: unknown): boolean {
  return typeof value === 'boolean'
}

function getDefaultColorForLoggingLevel(type: LoggingLevelType): string {
  switch (type) {
    case 'debug':
      return '#FFFFFF'
    case 'info':
      return '#2AA2F6'
    case 'warn':
      return '#FABA2F'
    case 'error':
      return '#F35369'
    case 'fatal':
      return '#F35369'
    default:
      return '#FFFFFF'
  }
}

class Logify<ErrorTypes = ErrorParamType> {
  private props: LogifyPropsType<ErrorTypes>
  // init constructor with LogifyPropsType
  constructor(props: LogifyPropsType<ErrorTypes>) {
    this.props = props
  }

  /**
   * Creates a single string with structure like "key=value key=value". Grafana used to expect this kind of structure as a log message. It doesn't do that anymore.
   * But it still looks pretty when logged like this to the terminal, so I'm still using this
   *
   * @param params `Record<string|number,string|number> | undefined` — Params to the log
   * if you want. Good practice is to add as few params as possible. Only provide a string or a number
   * as a value for a key, no nested structures
   *
   * @returns `string`
   *
   * @private
   */
  private _transformObjectToLogString = <K extends Record<string, unknown>>(params?: K | undefined): string => {
    if (params && isObject(params)) {
      const keys = Object.keys(params)
      let logString = ``

      keys.forEach(key => {
        let value: string | Record<string, unknown> | undefined

        if (key === 'error' && isFunction(this.props.parseError)) {
          value = this.props.parseError!(params[key] as ErrorTypes | ErrorParamType)
        } else {
          value = params[key] as string
        }

        if (isString(value) || isNumber(value)) {
          logString = `${logString}${key}=${value} `
        } else {
          // string is not of correct value
        }
      })

      return logString.trim()
    }

    return ''
  }

  /**
   * Creates an object that will later be used to store the log in case app is currently offline.
   * It constructs the object that is sent to the server in an already JSON stringified form.
   *
   * @param type `LoggingLevelType` - the logging level
   * @param message `string` - the log message
   * @param params `Record<string|number,string|number> | undefined` — You can add params to the log
   * if you want. Good practice is to add as few params as possible. Only provide a string or a number
   * as a value for a key, no nested structures
   *
   * @returns LogEvent
   */
  private _constructBackendLogEvent = <K extends LoggingLevelType, V extends string, T extends Record<string, unknown>>(
    type: K,
    message: V,
    params?: T | undefined,
  ) => {
    let paramsToSend = params
    const uppercaseType = type.toUpperCase()
    const formattedError =
      this.props.parseError?.(params?.error as ErrorTypes | ErrorParamType) ||
      (params?.error as ErrorTypes | ErrorParamType)
    const defaultParams = isFunction(this.props?.defaultParams)
      ? // @ts-ignore
        this.props.defaultParams!()
      : isObject(this.props.defaultParams)
      ? this.props.defaultParams
      : {}
    const sanitizedMessage = message
      .replace(/(?:[()\-&$#![\]{}"',.]+(?:\s|$)|(?:^|\s)[()\-&$#![\]{}"',.]+)/g, ' ')
      .trim()
      .toLowerCase()

    if (paramsToSend && formattedError) {
      if ('error' in paramsToSend) delete paramsToSend.error
      paramsToSend = {
        ...paramsToSend,
        ...formattedError,
      }
    }

    return JSON.stringify({
      ts: new Date(),
      level: uppercaseType,
      msg: sanitizedMessage,
      ...defaultParams,
      ...(paramsToSend || {}),
    })
  }

  /**
   * Creates a styled console log arguments depending on the log level
   *
   * @param type `LoggingLevelType` - the logging level
   * @param message `string` - the log message
   * @param params `Record<string|number,string|number> | undefined` — You can add params to the log
   * if you want. Good practice is to add as few params as possible. Only provide a string or a number
   * as a value for a key, no nested structures
   *
   * @returns `[logTitle, logTitleStyle, messageStyle]` - array of console.log arguments
   *
   * @private
   */
  private _constructStyledConsoleLogMessage = (type: LoggingLevelType, message: string, params: string) => {
    const typeText = type.toUpperCase()
    const loggingColor = this.props?.printColors?.[type] || getDefaultColorForLoggingLevel(type)
    const paramsString = params.length > 0 ? `${params}\n\n` : ''
    // const stackTrace = `Stack: ${new Error().stack?.split('\n')[3]?.split('at ')[1].split(' ')[0]}\n\n`

    const title = `\n\n%c${typeText}%c ${message}\n\n${paramsString}`
    const titleStyle = `font-weight: bold; font-size: 14px; color: black; padding: 0px 7px; background-color: ${loggingColor};`
    const messageStyle = `font-weight: bold; font-size: 12px; color: ${loggingColor};`

    return [title, titleStyle, messageStyle]
  }

  /**
   * Does a fire and forget fetch to Grafana endpoint with log
   * @param log `string` - JSON.stringify-ed log object
   * @private
   */
  private _sendLogToGrafana = async (log: string) => {
    const shouldSend = (): boolean => {
      const hasLogicToSend = isBoolean(this.props.shouldSendLogsIf) || isFunction(this.props.shouldSendLogsIf)

      if (!hasLogicToSend) {
        return true
      }

      return isBoolean(this.props.shouldSendLogsIf)
        ? this.props.shouldSendLogsIf
        : // @ts-ignore
        this.props?.shouldSendLogsIf?.()
    }

    if (shouldSend()) {
      fetch(this.props.endpoint, {
        method: 'POST',
        body: log,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
      }).catch(e => {
        this.debug('error sending log', e as Record<string, unknown>)
        this._store(log)
      })
    }
  }

  private _shouldLogToConsole = (): boolean => {
    const hasLogic = isBoolean(this.props.shouldLogToConsoleIf) || isFunction(this.props.shouldLogToConsoleIf)

    if (hasLogic) {
      return isBoolean(this.props.shouldLogToConsoleIf)
        ? (this.props.shouldLogToConsoleIf as unknown as boolean)
        : // @ts-ignore
          this.props.shouldLogToConsoleIf!()
    }

    return true
  }

  public debug = <K extends string, V extends Record<string, unknown>>(message: K, params?: V | undefined): void => {
    const logMessage = this._constructStyledConsoleLogMessage(
      'debug',
      message,
      this._transformObjectToLogString(params).split(' ').join('\n'),
    )

    console.log(...logMessage, params || '')
  }

  /**
   * Standard log level. Something went right and we want to know about it
   * @param message `string` — Log message you want to send
   * @param params `Record<string|number,string|number> | undefined` — You can add params to the log
   * if you want. Good practice is to add as few params as possible. Only provide a string or a number
   * as a value for a key, no nested structures
   */
  public info = <K extends string, V extends Record<string, unknown>>(message: K, params?: V | undefined): void => {
    const logMessage = this._constructStyledConsoleLogMessage(
      'info',
      message,
      this._transformObjectToLogString(params).split(' ').join('\n'),
    )

    if (this._shouldLogToConsole()) {
      console.log(...logMessage)
    }

    this._sendLogToGrafana(this._constructBackendLogEvent('info', message, params))
  }

  /**
   * Possible issue or suspicious behavior. Didn’t necessarily cause an error
   * @param message `string` — Log message you want to send
   * @param params `Record<string|number,string|number> | undefined` — You can add params to the log
   * if you want. Good practice is to add as few params as possible. Only provide a string or a number
   * as a value for a key, no nested structures
   */
  public warn = <K extends string, V extends Record<string, unknown>>(message: K, params?: V | undefined): void => {
    const logMessage = this._constructStyledConsoleLogMessage(
      'warn',
      message,
      this._transformObjectToLogString(params).split(' ').join('\n'),
    )

    if (this._shouldLogToConsole()) {
      console.log(...logMessage)
    }

    this._sendLogToGrafana(this._constructBackendLogEvent('warn', message, params))
  }

  /**
   * Something went wrong and someone should probably have a look
   * @param message `string` — Log message you want to send
   * @param params `Record<string|number,string|number> | undefined` — You can add params to the log
   * if you want. Good practice is to add as few params as possible. Only provide a string or a number
   * as a value for a key, no nested structures
   */
  public error = <K extends string, V extends Record<string, unknown>>(message: K, params?: V | undefined): void => {
    const logMessage = this._constructStyledConsoleLogMessage(
      'error',
      message,
      this._transformObjectToLogString(params).split(' ').join('\n'),
    )

    if (this._shouldLogToConsole()) {
      console.log(...logMessage)
    }

    this._sendLogToGrafana(this._constructBackendLogEvent('error', message, params))
  }

  /**
   * Something went really wrong and the software crashed. Someone should definitely have a look
   * @param message `string` — Log message you want to send
   * @param params `Record<string|number,string|number> | undefined` — You can add params to the log
   * if you want. Good practice is to add as few params as possible. Only provide a string or a number
   * as a value for a key, no nested structures
   */
  public fatal = <K extends string, V extends Record<string, unknown>>(message: K, params?: V | undefined): void => {
    const logMessage = this._constructStyledConsoleLogMessage(
      'fatal',
      message,
      this._transformObjectToLogString(params).split(' ').join('\n'),
    )

    if (this._shouldLogToConsole()) {
      console.log(...logMessage)
    }

    this._sendLogToGrafana(this._constructBackendLogEvent('fatal', message, params))
  }

  /**
   * Stores an event (due to auth token missing or no network connection) to be sent to Grafana later, using "sendStoredLogs" function.
   * @param log `string` - JSON.stringify-ed log object
   * @private
   */
  private _store = async (log: string) => {
    if (!this.props.storage) {
      return
    }

    const { key, getItem, setItem } = this.props.storage
    const storageKey = key ?? DEFAULT_STORAGE_KEY

    const data = await getItem(storageKey)

    const current = JSON.parse(data) || []
    await setItem(storageKey, JSON.stringify([...current, log]))
  }

  /**
   * Sends out all stored logs to Grafana.
   */
  public sendStoredLogs = async () => {
    if (!this.props.storage) {
      return
    }

    const { key, getItem, setItem } = this.props.storage
    const storageKey = key ?? DEFAULT_STORAGE_KEY

    const data = await getItem(storageKey)

    const logs = JSON.parse(data) || []

    if (!logs.length) {
      return
    }

    fetch(this.props.endpoint, {
      method: 'POST',
      body: logs,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
    })
      .then(async () => {
        await setItem(storageKey, JSON.stringify([]))
      })
      .catch(e => {
        this.debug('error sending stored logs', e)
      })
  }
}

export default Logify
