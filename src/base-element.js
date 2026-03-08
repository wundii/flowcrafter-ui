import { LitElement } from 'lit'

/**
 * Base class that disables Shadow DOM so global Tailwind/DaisyUI styles apply.
 */
export class BaseElement extends LitElement {
  createRenderRoot() {
    return this
  }
}
