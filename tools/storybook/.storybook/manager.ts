import {addons} from 'storybook/manager-api'
import {create} from 'storybook/theming'

addons.setConfig({
  theme: create({
    base: 'light',
    brandTitle:
      '<span style="display:inline-flex;align-items:center;gap:8px;font-weight:600;font-size:15px"><img src="./projections-mark-two-tone.svg" width="20" height="20" alt="">Projections</span>',
    brandTarget: '_self',
  }),
})
