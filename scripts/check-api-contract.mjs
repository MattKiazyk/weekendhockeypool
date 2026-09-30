import { readFile } from 'node:fs/promises'
import SwaggerParser from '@apidevtools/swagger-parser'
import YAML from 'yaml'

const document = YAML.parse(
  await readFile(new URL('../docs/api/openapi.yaml', import.meta.url), 'utf8'),
)
await SwaggerParser.validate(document)
console.log('Native API OpenAPI contract is valid')
