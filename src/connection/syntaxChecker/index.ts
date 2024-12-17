import IBMi from "@halcyontech/vscode-ibmi-types/api/IBMi";
import { ComponentIdentification, ComponentState, IBMiComponent } from "@halcyontech/vscode-ibmi-types/components/component";
import { posix } from "path";
import { getCheckerSource } from "./checker";
import { JobManager } from "../../config";
import { getInstance } from "../../base";

interface SqlError {
  CURSTMTLENGTH: number;
  ERRORFIRSTCOLUMNNUMBER: number;
  ERRORFIRSTRECORDNUMBER: number;
  ERRORLASTCOLUMNNUMBER: number;
  ERRORLASTRECORDNUMBER: number;
  ERRORREPLACEMENTTEXT: string;
  ERRORSQLMESSAGEID: string;
  ERRORSQLSTATE: string;
  ERRORSYNTAXCOLUMNNUMBER: number;
  ERRORSYNTAXRECORDNUMBER: number;
  MESSAGEFILELIBRARY: string;
  MESSAGEFILENAME: string;
  MESSAGETEXT: string;
  NUMBEROFSTATEMENTSBACK: number;
}

export class SQLStatementChecker implements IBMiComponent {
  static ID = "SQLStatementChecker";
  private readonly functionName = 'VALIDATE_STATEMENT';
  private readonly currentVersion = 1;

  private installedVersion = 0;
  private library = "";

  static get(): SQLStatementChecker|undefined {
    return getInstance().getConnection().getComponent<SQLStatementChecker>(SQLStatementChecker.ID);
  }

  reset() {
    this.installedVersion = 0;
    this.library = "";
  }

  getIdentification(): ComponentIdentification {
    return { name: SQLStatementChecker.ID, version: this.installedVersion };
  }

  async getRemoteState(connection: IBMi) {
    this.library = connection.config?.tempLibrary.toUpperCase() || "ILEDITOR";
    const [result] = await connection.runSQL(`select cast(LONG_COMMENT as VarChar(200)) LONG_COMMENT from qsys2.sysroutines where routine_schema = '${this.library}' and routine_name = '${this.functionName}'`);
    if (result?.LONG_COMMENT) {
      const comment = String(result.LONG_COMMENT);
      const dash = comment.indexOf('-');
      if (dash > -1) {
        this.installedVersion = Number(comment.substring(0, dash).trim());
      }
    }
    if (this.installedVersion < this.currentVersion) {
      return `NeedsUpdate`;
    }

    return `Installed`;
  }

  update(connection: IBMi): ComponentState | Promise<ComponentState> {
    return connection.withTempDirectory(async tempDir => {
      const tempSourcePath = posix.join(tempDir, `sqlchecker.sql`);
      await connection.content.writeStreamfileRaw(tempSourcePath, Buffer.from(this.getSource(), "utf-8"));
      const result = await connection.runCommand({
        command: `RUNSQLSTM SRCSTMF('${tempSourcePath}') COMMIT(*NONE) NAMING(*SYS)`,
        noLibList: true
      });

      if (result.code) {
        return `Error`;
      } else {
        return `Installed`;
      }
    });
  }

  private getSource() {
    return getCheckerSource(this.library, this.currentVersion);
  }

  async call(statement: string) {
    const currentJob = JobManager.getSelection();
    if (currentJob) {
      const result = await currentJob.job.execute<SqlError>(`select * from table(${this.library}.${this.functionName}(?)) x`, {parameters: [statement]});
      
      if (!result.success || result.data.length === 0) return;
      const sqlError = result.data[0];

      if (sqlError.ERRORSQLSTATE === `00000`) return;

      const replaceTokens = splitReplaceText(sqlError.ERRORREPLACEMENTTEXT)

      let text = sqlError.MESSAGETEXT;
      replaceTokens.forEach((token, index) => {
        text = text.replace(`&${index+1}`, token);
      });

      return {
        sqlid: sqlError.ERRORSQLMESSAGEID,
        sqlstate: sqlError.ERRORSQLSTATE,
        text,
        offset: sqlError.ERRORSYNTAXCOLUMNNUMBER,
      };
    }

    return undefined;
  }
}

function splitReplaceText(input: string) {
    const firstGoodChar = input.split('').findIndex(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126);

    let replacements: string[] = [];    
    let inReplacement = false;
    let currentReplacement = ``;

    for (let i = firstGoodChar; i < input.length; i++) {
      const isGoodChar = input.charCodeAt(i) >= 32 && input.charCodeAt(i) <= 126;

      if (isGoodChar) {
        inReplacement = true;

        if (inReplacement) {
          currentReplacement += input[i];
        }
      } else {
        if (inReplacement) {
          replacements.push(currentReplacement);
          currentReplacement = ``;
        }
        
        inReplacement = false;
      }
    }

    if (currentReplacement) {
      replacements.push(currentReplacement);
    }

    return replacements;
  }