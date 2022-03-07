# @colorfy-software/logify

> This is a simple wrapper for sending logs

[![NPM](https://img.shields.io/npm/v/@colorfy-software/logify.svg)](https://www.npmjs.com/package/@colorfy-software/logify) [![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

# Installation

    $ yarn add @colorfy-software/logify

# Usage

## Creating a logger

```typescript
// core/logging-core.ts

import Logify from '@colorfy-software/logify'

interface CustomErrorType {
  message: string
  code: number
}

const logger = new Logify<CustomErrorType>({
  endpoint: 'http://some-endpoint.com',
  // Can be an object or a function, get's added to each log
  defaultParams?: {
    userId: getUserId()
    source: 'app'
  },
  // Error here has CustomErrorType | DefaultErrorType(from lib), can parse error to be something useful
  parseError?: (error) => {
    // do stuff with error
    return parsedErrorMessage
  },
  // Condition if logs should be sent to server. Can be a function. Defaults to true
  shouldSendLogsIf?: !__DEV__,
  // Condition if logs should be shown in console. Can be a function. Defaults to true
  shouldLogToConsoleIf?: true,
  // Possibility to edit colors that are printed to console
  printColors?: {
    debug?: string,
    info?: string,
    warn?: string,
    error?: string,
    fatal?: string,
  }
})

export default logger
```

## Using the logger

```typescript
// any-file.ts

import core from '../core'

core.logger.error('userRegistrationError', gigyaError)
```
