import type {
  IssueTemplate,
  IssueTemplateWithLastExecution,
  IssueTemplateExecution,
  IssueTemplateChild,
  CreateIssueTemplateInput,
  UpdateIssueTemplateInput,
} from "@domain/issue-template/model";
import type { CreateIssueInput } from "@domain/issue/model";
import type { Issue, Stage } from "@domain/issue/model";

/** 最小 collaboration 端口：调度器只需 createIssue 能力 */
export interface CreateIssuePort {
  createIssue(input: CreateIssueInput): Promise<{ issue: Issue; stage: Stage }>;
}

/** IssueTemplate 域端口 */
export interface IssueTemplatePort {
  list(): IssueTemplateWithLastExecution[];
  findById(id: string): IssueTemplate | undefined;
  create(input: CreateIssueTemplateInput): IssueTemplate;
  update(id: string, input: UpdateIssueTemplateInput): IssueTemplate;
  remove(id: string): void;
  toggle(id: string): IssueTemplate;
  listExecutions(templateId: string): IssueTemplateExecution[];
  listChildren(templateId: string): IssueTemplateChild[];
  start(): void;
  stop(): void;
}
