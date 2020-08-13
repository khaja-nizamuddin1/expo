import { Command } from '@expo/commander';
import { request } from '@octokit/request';
import fs from 'fs-extra';
import chalk from 'chalk';
import inquirer from 'inquirer';
import path from 'path';

import { filterAsync } from '../Utils';
import { EXPO_DIR } from '../Constants';
import Git from '../Git';
import logger from '../Logger';

type CommandOptions = {
  ref?: string;
};

type Workflow = {
  id: number;
  name: string;
  path: string;
};

export default (program: Command) => {
  program
    .command('workflow-dispatch [workflowName]')
    .alias('dispatch', 'wd')
    .option(
      '-r, --ref <ref>',
      'The reference of the workflow run. The reference can be a branch, tag, or a commit SHA.'
    )
    .description(
      `Dispatches an event that triggers a workflow on GitHub Actions. Requires ${chalk.magenta(
        'GITHUB_TOKEN'
      )} env variable to be set.`
    )
    .asyncAction(main);
};

/**
 * Main action of the command.
 */
async function main(workflowName: string | undefined, options: CommandOptions) {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error('Environment variable `GITHUB_TOKEN` must be set.');
  }

  const workflows = await getWorkflowsAsync();
  const workflowId = await findWorkflowIdAsync(workflows, workflowName);
  const ref = options.ref || (await Git.getCurrentBranchNameAsync());

  if (!workflowId || !workflows.some((workflow) => workflow.id === workflowId)) {
    throw new Error(`Unable to find workflow with ID \`${workflowId}\`.`);
  }
  await dispatchWorkflowAsync(workflowId, ref);
}

/**
 * Requests for the list of active workflows.
 */
async function getWorkflowsAsync(): Promise<Workflow[]> {
  const response = await request('GET /repos/:owner/:repo/actions/workflows', {
    owner: 'expo',
    repo: 'expo',
  });

  // We need to filter out some workflows because they might have
  // - empty `name` or `path` (why?)
  // - inactive state
  // - workflow config no longer exists
  const workflows = await filterAsync(response.data.workflows, async (workflow) =>
    Boolean(
      workflow.name &&
        workflow.path &&
        workflow.state === 'active' &&
        (await fs.pathExists(path.join(EXPO_DIR, workflow.path)))
    )
  );
  return workflows.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Finds workflow ID based on given name or config filename.
 */
async function findWorkflowIdAsync(
  workflows: Workflow[],
  workflowName: string | undefined
): Promise<number | null> {
  if (!workflowName) {
    if (process.env.CI) {
      throw new Error('Command requires `workflowName` argument when run on the CI.');
    }
    return await promptWorkflowIdAsync(workflows);
  }

  const slug = workflowName.toLowerCase();
  const workflow = workflows.find((workflow) => {
    return (
      workflow.name.toLowerCase() === slug ||
      workflow.path.toLowerCase() === `.github/workflows/${slug}.yml`
    );
  });
  return workflow?.id ?? null;
}

/**
 * Dispatches an event that triggers a workflow with given ID.
 */
async function dispatchWorkflowAsync(workflowId: number, ref: string): Promise<void> {
  const response = await request(
    'POST /repos/:owner/:repo/actions/workflows/:workflow_id/dispatches',
    {
      headers: {
        authorization: `token ${process.env.GITHUB_TOKEN}`,
      },
      owner: 'expo',
      repo: 'expo',
      workflow_id: workflowId,
      ref,
    }
  );
  if (response.status !== 204) {
    logger.error('💥 Dispatching workflow failed with response', JSON.stringify(response, null, 2));
    process.exit(1);
  }
  logger.success('🎉 Successfully dispatched workflow event ');
}

/**
 * Prompts for the workflow to trigger.
 */
async function promptWorkflowIdAsync(workflows: Workflow[]): Promise<number> {
  const { workflowId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'workflowId',
      message: 'Which workflow do you want to dispatch?',
      choices: workflows.map((workflow) => ({ name: workflow.name, value: workflow.id })),
      pageSize: workflows.length,
    },
  ]);
  return workflowId;
}
