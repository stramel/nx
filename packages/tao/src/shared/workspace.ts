import * as fs from 'fs';
import * as path from 'path';
import '../compat/compat';

export interface WorkspaceDefinition {
  projects: { [projectName: string]: ProjectDefinition };
  defaultProject?: string;
  generators?: { [collectionName: string]: { [generatorName: string]: any } };
  cli?: { defaultCollection: string };
}

export interface ProjectDefinition {
  targets: { [targetName: string]: TargetDefinition };
  root: string;
  generators?: { [collectionName: string]: { [generatorName: string]: any } };
  prefix?: string;
  sourceRoot?: string;
}

export interface TargetDefinition {
  options?: any;
  outputs?: string[];
  configurations?: { [config: string]: any };
  executor: string;
}

export function workspaceConfigName(root: string) {
  try {
    fs.statSync(path.join(root, 'angular.json'));
    return 'angular.json';
  } catch (e) {
    return 'workspace.json';
  }
}

export class Workspaces {
  readWorkspaceConfiguration(root: string): WorkspaceDefinition {
    const w = JSON.parse(
      fs.readFileSync(path.join(root, workspaceConfigName(root))).toString()
    );

    Object.values(w.projects).forEach((project: any) => {
      if (!project.targets && project.architect) {
        project.targets = project.architect;
        project.architect = undefined;
      }

      Object.values(project.targets).forEach((target: any) => {
        if (!target.executor && target.builder) {
          target.executor = target.builder;
          target.builder = undefined;
        }
      });

      if (!project.generators && project.schematics) {
        project.generators = project.schematics;
        project.schematics = undefined;
      }
    });

    if (!w.generators && w.schematics) {
      w.generators = w.schematics;
      w.schematics = undefined;
    }

    return w;
  }

  isNxExecutor(target: TargetDefinition) {
    const schema = this.readExecutor(target).schema;
    return schema['cli'] === 'nx';
  }

  isNxGenerator(collectionName: string, generatorName: string) {
    const schema = this.readGenerator(collectionName, generatorName).schema;
    return schema['cli'] === 'nx';
  }

  readExecutor(target: TargetDefinition) {
    try {
      const {
        executor,
        executorsFilePath,
        executorsJson,
      } = this.readExecutorsJson(target);
      const executorsDir = path.dirname(executorsFilePath);
      const executorConfig = executorsJson.executors[executor] || executorsJson.builders[executor];
      const schemaPath = path.join(executorsDir, executorConfig.schema || '');
      const schema = JSON.parse(fs.readFileSync(schemaPath).toString());
      const module = require(path.join(executorsDir, executorConfig.implementation));
      const implementation = module.default;
      return { schema, implementation };
    } catch (e) {
      throw new Error(`Unable to resolve ${target.executor}.\n${e.message}`);
    }
  }

  readGenerator(collectionName: string, generatorName: string) {
    try {
      const {
        generatorsFilePath,
        generatorsJson,
        normalizedGeneratorName,
      } = this.readGeneratorsJson(collectionName, generatorName);
      const generatorsDir = path.dirname(generatorsFilePath);
      const generatorConfig = (generatorsJson.generators ||
        generatorsJson.schematics)[normalizedGeneratorName];
      const schemaPath = path.join(generatorsDir, generatorConfig.schema || '');
      const schema = JSON.parse(fs.readFileSync(schemaPath).toString());
      const module = require(path.join(
        generatorsDir,
        generatorConfig.implementation
          ? generatorConfig.implementation
          : generatorConfig.factory
      ));
      const implementation = module.default;
      return { schema, implementation };
    } catch (e) {
      throw new Error(
        `Unable to resolve ${collectionName}:${generatorName}.\n${e.message}`
      );
    }
  }

  private readExecutorsJson(target: TargetDefinition) {
    const [nodeModule, executor] = target.executor.split(':');
    const packageJsonPath = require.resolve(`${nodeModule}/package.json`);
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath).toString());
    const executorsFile = packageJson.executors ? packageJson.executors : packageJson.executors;
    const executorsFilePath = require.resolve(
      path.join(path.dirname(packageJsonPath), executorsFile)
    );
    const executorsJson = JSON.parse(
      fs.readFileSync(executorsFilePath).toString()
    );
    if (!executorsJson.executors[executor] && !executorsJson.builders[executor]) {
      throw new Error(
        `Cannot find executor '${executor}' in ${executorsFilePath}.`
      );
    }
    return { executor, executorsFilePath, executorsJson };
  }

  private readGeneratorsJson(collectionName: string, generator: string) {
    let generatorsFilePath;
    if (collectionName.endsWith('.json')) {
      generatorsFilePath = require.resolve(collectionName);
    } else {
      const packageJsonPath = require.resolve(`${collectionName}/package.json`);
      const packageJson = JSON.parse(
        fs.readFileSync(packageJsonPath).toString()
      );
      const generatorsFile = packageJson.generators
        ? packageJson.generators
        : packageJson.schematics;
      generatorsFilePath = require.resolve(
        path.join(path.dirname(packageJsonPath), generatorsFile)
      );
    }
    const generatorsJson = JSON.parse(
      fs.readFileSync(generatorsFilePath).toString()
    );

    let normalizedGeneratorName;
    const gens = generatorsJson.generators || generatorsJson.schematics;
    for (let k of Object.keys(gens)) {
      if (k === generator) {
        normalizedGeneratorName = k;
        break;
      }
      if (gens[k].aliases && gens[k].aliases.indexOf(generator) > -1) {
        normalizedGeneratorName = k;
        break;
      }
    }

    if (!normalizedGeneratorName) {
      for (let parent of generatorsJson.extends || []) {
        try {
          return this.readGeneratorsJson(parent, generator);
        } catch (e) {}
      }

      throw new Error(
        `Cannot find generator '${generator}' in ${generatorsFilePath}.`
      );
    }
    return { generatorsFilePath, generatorsJson, normalizedGeneratorName };
  }
}
