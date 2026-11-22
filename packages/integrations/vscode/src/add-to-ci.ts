import * as vscode from 'vscode'
import {openExternal} from './docs.js'
import {askAgent} from './new-projection/steps.js'
import {addToCiGuide, addToCiPrompt, isAddToCiChoice, type AddToCiChoice} from './projections/ci.js'

const items: (vscode.QuickPickItem & {choice: AddToCiChoice})[] = [
  {
    choice: 'agent',
    label: '$(sparkle) Ask Your Coding Agent',
    detail: 'The agent proposes where the step goes in your CI and shows you the change.',
  },
  {choice: 'copy', label: '$(copy) Copy the Prompt', detail: 'For a coding agent outside VS Code.'},
  {
    choice: 'guide',
    label: '$(book) Read the Guide',
    detail: 'Where the step goes, what it needs and why: Add Projections to CI, on GitHub.',
  },
]

/**
 * **Projections: Add to CI…**: hands adding the Projections step to the repository's CI to the coding agent, copies
 * its prompt, or opens the guide. It never writes a workflow. `choice` (from the Explore view or a test) skips the pick.
 */
export async function addToCi(choice?: unknown): Promise<AddToCiChoice | undefined> {
  const picked = isAddToCiChoice(choice)
    ? choice
    : (
        await vscode.window.showQuickPick(items, {
          title: 'Add Projections to CI',
          placeHolder: 'Where the step goes depends on your CI: usually the job that already installs and builds',
        })
      )?.choice
  if (picked === 'agent') await askAgent(addToCiPrompt)
  else if (picked === 'copy') {
    await vscode.env.clipboard.writeText(addToCiPrompt)
    void vscode.window.showInformationMessage('Projections: copied the Add to CI prompt. Paste it into your coding agent.')
  } else if (picked === 'guide') await openExternal(vscode.Uri.parse(addToCiGuide))
  return picked
}
