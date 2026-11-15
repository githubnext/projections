export type ToolInput = Record<string, unknown>
/** A tool's answer: text for the model, and a screenshot's image. */
export type ToolAnswer = string | {text: string; image: {data: string; mimeType: string}}
export interface Prepared {
  invocationMessage: string
  confirmation?: {title: string; message: string}
}
