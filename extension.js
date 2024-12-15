// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require("vscode");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const bibtexParse = require("@orcid/bibtex-parse-js");

function getServerUrl() {
  return vscode.workspace.getConfiguration("zotero-cite").get("serverUrl", "http://localhost:23119");
}

const json_rpc = `${getServerUrl()}/better-bibtex/json-rpc`;
const cayw = `${getServerUrl()}/better-bibtex/cayw`;

let latastBibName = "";
const outputChannel = vscode.window.createOutputChannel("Zotero Cite");

function showStatusMessage(message) {
  vscode.window.setStatusBarMessage(message, 1500);
}

function showErrorMessage(message) {
  vscode.window.showErrorMessage(message);
}

function showInformationMessage(message) {
  vscode.window.showInformationMessage(message);
}

function bibliograpyStyle() {
  return vscode.workspace
    .getConfiguration("zotero-cite")
    .get("bibliograpyStyle", "http://www.zotero.org/styles/apa");
}

function latexBibStyle() {
  return vscode.workspace.getConfiguration("zotero-cite").get("latexBibStyle");
}

function defaultBibName() {
  if (latastBibName == "") {
    latastBibName = vscode.workspace
      .getConfiguration("zotero-cite")
      .get("defaultBibName", "ref.bib");
  }
  return latastBibName;
}

function minimizeZotero() {
  return vscode.workspace.getConfiguration("zotero-cite").get("minimizeZotero");
}

/**
 * 获取文档中引用的键列表
 */
function getDocumentCiteKeys() {
  const editor = vscode.window.activeTextEditor;
  const content = editor.document.getText();
  var p;

  if (editor.document.languageId == "markdown") {
    p = /\[([@^][\w-:\d]+(;| ){0,2})+\]/g;
  }

  if (editor.document.languageId == "latex") {
    p = /cite[tp]?(\[[^\]]*\])?\{([\w-:\d]+(,| ){0,2})+\}/g;
  }

  if (p != null) {
    var ms = getMatchList(p, content);
    return getCiteKeyList(ms);
  }
}

// 根据latex和markdown环境的不同，导出所有的bibliography到文件中
async function exportBibLatex() {
  try {
    const editor = vscode.window.activeTextEditor;
    var currentlyOpenTabfilePath = editor.document.uri.fsPath;
    var bibName;

    // Current file tab is not saved.
    if (currentlyOpenTabfilePath.indexOf("Untitled") != -1) {
      throw new Error("Please SAVE Current Tab.");
    }

    // Ask for bib file name
    await vscode.window
      .showInputBox({
        value: defaultBibName(),
        prompt: "File Name:",
      })
      .then((value) => {
        bibName = value;
      });

    if (bibName === undefined) {
      throw new Error("Cancelled.");
    }

    if (bibName.length < 5 || path.extname(bibName) != ".bib") {
      throw new Error("bibName is invalid or its length is less than 5.");
    }

    // Create bib Path
    var parentDir = path.dirname(currentlyOpenTabfilePath);
    var bibPath = path.join(parentDir, bibName);

    // 获取键列表
    const keys = getDocumentCiteKeys();

    // 去除重复的问题
    var uniqueKeys = Array.from(new Set(keys));

    // 代表不需要导出
    if (uniqueKeys.length == 0) {
      throw new Error("No key detected.");
    }

    getBibliography(uniqueKeys)
      .then((res) => {
        fs.writeFileSync(bibPath, res + "\n", {
          encoding: "utf-8",
        });
        showStatusMessage("Export Successfully.");

        // 如果用户重新输入了bib文件名，那么就更新保持最后修改的名称
        latastBibName = bibName;
      })
      .catch((err) => {
        if (err instanceof vscode.CancellationError) {
          showStatusMessage("Bibliography 导出已取消");
          return;
        }
        showErrorMessage(err.message);
      });
  } catch (err) {
    showErrorMessage(err.message);
  }
}

/**
 * 将文字输入到目标位置
 * @param {string} text 要输入的文字
 * @param {int} location 输入的位置，-1代表当前位置，-2代表最尾行，其他的代表目标位置
 */
function insertText(text, location = -1) {
  const editor = vscode.window.activeTextEditor;
  editor.edit((editBuilder) => {
    if (location == -1) {
      editBuilder.insert(editor.selection.active, text);
    } else if (location == -2) {
      const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
      editBuilder.insert(new vscode.Position(lastLine.lineNumber + 1, 0), text);
    } else {
      var position = editor.document.positionAt(location);
      editBuilder.insert(position, text);
    }
  });
}

async function insertTextAsync(text, location = -1) {
  const editor = vscode.window.activeTextEditor;
  await editor.edit((editBuilder) => {
    if (location == -1) {
      editBuilder.insert(editor.selection.active, text);
    } else if (location == -2) {
      const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
      editBuilder.insert(new vscode.Position(lastLine.lineNumber + 1, 0), text);
    } else {
      var position = editor.document.positionAt(location);
      editBuilder.insert(position, text);
    }
  });
}

/**
 * https://stackoverflow.com/questions/44182951/axios-chaining-multiple-api-requests
 * https://retorque.re/zotero-better-bibtex/citing/cayw/
 * 返回key数组
 * @returns string[]
 */
async function pickCiteKeys() {
  var citeKeys = [];
  // params: {
  //     "format": "pandoc",
  //     "brackets": "1",
  //     "minimize": 'true'
  // }

  await axios({
    method: "get",
    url: cayw,
    params: {
      format: "pandoc",
      brackets: "1",
      // minimize: true,
      minimize: minimizeZotero()
    },
  })
    .then((res) => {
      // const pattern = /\[@([^\]]+)\]/g;
      const pattern = /@([\w-:\d]+)/g;
      while ((m = pattern.exec(res.data)) != null) {
        citeKeys.push(m[1]);
      }
    })
    .catch((err) => {
      showErrorMessage(err.message);
    });

  // 代表没有选择item，抛出异常。
  if (citeKeys.length == 0) {
    throw new Error("No item is selected.");
  }

  return citeKeys;
}

/**
 * 对于markdown文件的书写，选择key，然后插入bibliography，
 * key的格式为：[^k1][^k2]
 * bibliography的格式：
 *   [^k1]: content
 *   [^k2]: content
 */
async function citeMarkdownBibliography() {
  try {
    // 获取键列表
    var existKeys = getDocumentCiteKeys();

    // 获取键值
    var citeKeys = await pickCiteKeys();

    // insert markdown citation
    insertText("[^" + citeKeys.join("][^") + "]");

    // 插入插入bibliography，并过滤已经插入的
    citeKeys.forEach((e) => {
      if (!existKeys.includes(e)) {
        insertMarkdownBibliography(e);
      }
    });
  } catch (err) {
    showErrorMessage(err.message);
  }
}

/**
 * 根据item的key，插入markdown格式的bibliography
 * @param {string} citeKey item的Key
 */
function insertMarkdownBibliography(citeKey) {
  const pyload = JSON.stringify({
    jsonrpc: "2.0",
    method: "item.bibliography",
    params: [
      ["@" + citeKey],
      {
        id: bibliograpyStyle(),
      },
    ],
  });

  axios({
    method: "post",
    url: json_rpc,
    headers: {
      "Content-Type": "application/json",
    },
    data: pyload,
  })
    .then((res) => {
      const data = res.data;

      if ("error" in data) {
        let err = data["error"];
        throw new Error(err["message"]);
      }

      const bibliographyText = "[^" + citeKey + "]: " + data["result"];

      // enter text to the file end.
      insertText(bibliographyText, -2);
    })
    .catch((err) => {
      showErrorMessage(err.message);
    });
}

/**
 * 根据bib文件的路径，获取其中的bibentry的key数组
 * @param {string} bibPath bib文件的路径
 * @returns string[]
 */
function getBibliographyKeyFromFile(bibPath) {
  // 代表文件不存在，返回空数组
  if (!fs.existsSync(bibPath)) {
    return new Array();
  }

  var content = fs.readFileSync(bibPath, {
    encoding: "utf8",
  });

  var jsonBibs = bibtexParse.toJSON(content);

  return jsonBibs.map((jb) => jb["citationKey"]);
}

/**
 * todo: 给该函数添加智能检测功能
 * 给pandoc以及latex添加citation，不添加bibentry
 */
async function addCitation() {
  try {
    var citeKeys = await pickCiteKeys();
    insertCiteKeys(citeKeys);
  } catch (err) {
    showErrorMessage(err.message);
  }
}

/**
 * 在pandoc以及latex文档编写过程中，将key数组插入到文档中
 * @param {string[]} keyList key数组
 */
function insertCiteKeys(keyList) {
  const editor = vscode.window.activeTextEditor;
  var addLocation = getKeyEnvOffset();

  // insert latex citation。
  if (editor.document.languageId == "latex") {
    if (addLocation == null) {
      insertText("\\cite{" + keyList.join(", ") + "}");
    } else {
      insertText(", " + keyList.join(", "), addLocation - 1);
    }
  }

  // insert pandoc citation
  if (editor.document.languageId == "markdown") {
    if (addLocation == null) {
      insertText("[" + keyList.map((v) => "@" + v).join("; ") + "]");
    } else {
      insertText(
        "; " + keyList.map((v) => "@" + v).join("; "),
        addLocation - 1
      );
    }
  }
}

/**
 * 给pandoc以及latex添加citation以及bibliography
 */
async function citeBibliography() {
  try {
    const editor = vscode.window.activeTextEditor;
    var currentlyOpenTabfilePath = editor.document.uri.fsPath;

    // Current file tab is not saved.
    if (currentlyOpenTabfilePath.indexOf("Untitled") != -1) {
      throw new Error("Please SAVE Current Tab.");
    }

    // 得到bib文件的默认文件名
    const bibName = defaultBibName();

    if (bibName.length < 5 || path.extname(bibName) != ".bib") {
      throw new Error("bibName is invalid or its length is less than 5.");
    }

    let bibName_replaced = bibName;
    // 替换bibName中的${workspaceFolder}为工作目录的路径
    bibName_replaced = bibName_replaced.replace("${workspaceFolder}", vscode.workspace.rootPath);
    // 替换bibName中的${fileBasename}为当前文件的文件名
    bibName_replaced = bibName_replaced.replace("${fileBasename}", path.basename(currentlyOpenTabfilePath));
    // 替换bibName中的${fileBasenameNoExtension}为当前文件的文件名，不带后缀
    bibName_replaced = bibName_replaced.replace("${fileBasenameNoExtension}", path.basename(currentlyOpenTabfilePath, ".bib"));
    // 替换bibName中的${fileDirname}为当前文件的目录名
    bibName_replaced = bibName_replaced.replace("${fileDirname}", path.dirname(currentlyOpenTabfilePath));
    // 替换bibName中的${fileExtname}为当前文件的后缀名
    bibName_replaced = bibName_replaced.replace("${fileExtname}", path.extname(currentlyOpenTabfilePath));
    // 替换bibName中的${fileBasenameNoExtension}为当前文件的文件名，不带后缀
    bibName_replaced = bibName_replaced.replace("${fileBasenameNoExtension}", path.basename(currentlyOpenTabfilePath, ".bib"));

    let bibPath = bibName_replaced;
    if(path.isAbsolute(bibName_replaced)) {
      // bibPath = bibName_replaced;
    } else {      
      bibPath = path.join(path.dirname(currentlyOpenTabfilePath), bibName_replaced);
    }

    // get selected keys
    var citeKeys = await pickCiteKeys();
    insertCiteKeys(citeKeys);

    // 根据bib文件，而不是cite去获取keys。
    var bibKeys = getBibliographyKeyFromFile(bibPath);

    // 过滤已经包含的引用
    var uniqueKeys = citeKeys.filter((v, i) => !bibKeys.includes(v));

    // 如果为空，代表不需要添加内容的bib文件里边
    if (uniqueKeys.length == 0) {
      return;
    }

    getBibliography(uniqueKeys)
      .then((res) => {
        fs.writeFileSync(bibPath, res + "\n", {
          flag: "a",
          encoding: "utf8",
        });
      })
      .catch((err) => {
        if (err instanceof vscode.CancellationError) {
          showStatusMessage("Bibliography 导出已取消");
          return;
        }
        showErrorMessage(err.message);
      });
  } catch (err) {
    showErrorMessage(err.message);
  }
}

/**
 * 获取用户在 Zotero 中拥有的组（group，也称为libraries）
 * @returns {{}} 返回一个对象，key为组名，value为组的id
 */
async function getGroups() {
  let pyload = JSON.stringify({
    jsonrpc: "2.0",
    method: "user.groups",
  });

  return axios({
    method: "post",
    url: json_rpc,
    headers: {
      "Content-Type": "application/json",
    },
    data: pyload,
  }).then((res) => {
    let data = res.data;

    if ("error" in data) {
      let err = data["error"];
      throw new Error(err["message"]);
    }

    // convert [{"id":1,"name":"My Library"},{"id":2,"name":"ncist-zyl"}] to {"My Library":1, "ncist-zyl":2}
    let groups = {};
    for (const ikey in data["result"]) {
      let item = data["result"][ikey];
      groups[item["name"]] = item["id"];
    }

    return groups;
  });
}

/**
 * 根据 key 获取 item 所在组的名称
 * @param {string} key item的key
 * @returns {string}
 */
async function getItemGroupName(key) {
  let pyload = JSON.stringify({
    jsonrpc: "2.0",
    method: "item.search",
    params: [key],
  });

  console.log(pyload);

  return axios({
    method: "post",
    url: json_rpc,
    headers: {
      "Content-Type": "application/json",
    },
    data: pyload,
  }).then((res) => {
    let data = res.data;

    if ("error" in data) {
      let err = data["error"];
      throw new Error(err["message"]);
    }

    for (const ikey in data["result"]) {
      let item = data["result"][ikey];
      if (item["citation-key"] === key) {
        return item["library"];
      }
    }

    throw new Error(`'${key}' is not found.`);
  });
}

/**
 * 根据key列表和组ID获取bibliography列表
 * @param {string[]} keys key列表
 * @param {string} groupId 组id
 * @returns string
 */
async function getBibliographyInGroup(keys, groupId) {
  let pyload = JSON.stringify({
    jsonrpc: "2.0",
    method: "item.export",
    params: [keys, latexBibStyle(), groupId],
  });

  console.log(pyload);

  // requests bibliography
  return axios({
    method: "post",
    url: json_rpc,
    headers: {
      "Content-Type": "application/json",
    },
    data: pyload,
  }).then((res) => {
    let data = res.data;

    if ("error" in data) {
      let err = data["error"];
      throw new Error(err["message"]);
    }

    return data["result"];
  });
}

/**
 * 根据key列表获取bibliography列表
 * @param {string[]} keys
 * @returns string
 */
async function getBibliography(keys) {
  // 由于Better BibTeX for Zotero item.export调用一次只能获取一个组的bibliography，所以需要分组获取
  var groups = await getGroups();
  // 如果只有一个组，直接获取
  if (Object.keys(groups).length === 1) {
    return getBibliographyInGroup(keys, Object.values(groups)[0]);
  }

  // 如果有多个组，需要根据key获取item所在组的名称，然后分组获取
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "正在导出bibliography...",
      cancellable: true,
    },
    async (progress, token) => {
      let totalProgress = Object.keys(groups).length + keys.length;
      // 初始化进度
      progress.report({ increment: 0 });

      var groupItems = {};

      var allErrors = [];

      for (const key in keys) {
        if (token.isCancellationRequested) {
          throw new vscode.CancellationError();
        }
        const itemKey = keys[key];
        progress.report({
          increment: 0,
          message: `正在获取 ${itemKey} 的组信息...`,
        });
        try {
          const groupName = await getItemGroupName(itemKey);

          if (groupName in groupItems) {
            groupItems[groupName].push(itemKey);
          } else {
            groupItems[groupName] = [itemKey];
          }
        } catch (err) {
          outputChannel.appendLine(err.message);
          if (err?.message && !err?.message?.includes("is not found")) {
            allErrors.push(err.message);
          }
        }

        progress.report({ increment: 100 / totalProgress });
      }
      var bibs = [];
      for (const groupName in groupItems) {
        if (token.isCancellationRequested) {
          throw new vscode.CancellationError();
        }
        const groupId = groups[groupName];
        progress.report({
          increment: 0,
          message: `正在获取组 '${groupName}' 的bibliography...`,
        });
        const bib = await getBibliographyInGroup(
          groupItems[groupName],
          groupId
        );
        bibs.push(bib);
        progress.report({ increment: 100 / totalProgress });
      }
      if (allErrors.length > 0) {
        vscode.window.showInformationMessage(
          "Bibliography 导出成功，但是有一些错误，请查看输出面板"
        );
      } else {
        showStatusMessage("Bibliography 导出成功");
      }

      return bibs.join("\n\n");
    }
  );
}

/**
 * 输入一段正则表达式以及文字，导出匹配的列表
 * 匹配引用键的正则：var p = /\[([@^][\w-:\d]+(; )?)+\]/g;
 * @param {pattern} pattern 正则表达式
 * @param {string} text 需要解析的文字
 * @returns 匹配的列表
 */
function getMatchList(pattern, text) {
  var matchList = [];
  while ((m = pattern.exec(text)) != null) {
    matchList.push(m);
  }
  return matchList;
}

/**
 * 根据key的匹配列表，返回key列表
 * @param {match} keyMatchList 匹配的列表
 * @returns key数组
 */
function getCiteKeyList(keyMatchList) {
  var citeKeyList = [];
  keyMatchList.forEach((v, i) => {
    // 处理latex的情况
    var a = v[0].replace(/^cite[tp]?/, "");
    var p = /(\w|\d)+/g;
    var keyMatches = getMatchList(p, a);
    keyMatches.forEach((vi, ii) => {
      citeKeyList.push(vi[0]);
    });
  });
  return citeKeyList;
}

/**
 * 判断鼠标是否在键的环境中，是的话，返回环境的end index，否则为null
 * @returns 键的offset
 */
function getKeyEnvOffset() {
  const editor = vscode.window.activeTextEditor;
  // const content = editor.document.getText();
  const data = getCursorRoundText();
  var p;
  var cursorLocation = editor.document.offsetAt(editor.selection.active);

  if (editor.document.languageId == "markdown") {
    p = /\[([@^][\w-:\d]+(;| ){0,2})+\]/g;
  }

  if (editor.document.languageId == "latex") {
    p = /cite[tp]?\{([\w-:\d]+(,| ){0,2})+\}/g;
  }

  if (p == null) {
    return p;
  }

  var matches = getMatchList(p, data.content);
  for (const key in matches) {
    if (Object.hasOwnProperty.call(matches, key)) {
      const m = matches[key];
      let startIndex = m.index + data.startIndex;
      let endIndex = m.index + m[0].length + data.startIndex;
      if (cursorLocation >= startIndex && cursorLocation <= endIndex) {
        return endIndex;
      }
    }
  }

  return null;
}

/**
 * 获取鼠标前后目标长度的文字内容
 * @param {int} length 取字范围
 * @returns 目标文字
 */
function getCursorRoundText(length = 50) {
  const editor = vscode.window.activeTextEditor;
  var textLength = editor.document.getText().length;

  if (editor.selection.isEmpty) {
    const cursorPosition = editor.selection.active;
    const cursorIndex = editor.document.offsetAt(cursorPosition);

    const startIndex = Math.max(cursorIndex - length, 0);
    const endIndex = Math.min(cursorIndex + length, textLength);

    const startPos = editor.document.positionAt(startIndex);
    const endPos = editor.document.positionAt(endIndex);

    var objectRange = new vscode.Range(startPos, endPos);
    var objectText = editor.document.getText(objectRange);

    return {
      startIndex: startIndex,
      content: objectText,
    };
  }
}

function makeid(length) {
  var result = "";
  var characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var charactersLength = characters.length;
  for (var i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

//将超链接设置为引用
// https://stackoverflow.com/questions/54632431/vscode-api-read-clipboard-text-content
async function addHyperLinkCitation() {
  const editor = vscode.window.activeTextEditor;
  // 从剪切板获取内容
  let clipboard_content = await vscode.env.clipboard.readText();

  if (clipboard_content == "") {
    showErrorMessage("No Data in Clipboard.");
    return;
  }

  //1. 生成一个随机字符串
  var key = makeid(8);
  var keyContent = `[^${key}]`;
  var appContent = `\n[^${key}]: <${clipboard_content}>`;

  // insert pandoc citation
  if (editor.document.languageId == "markdown") {
    await insertTextAsync(keyContent);
    await insertTextAsync(appContent, -2);
  }
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Congratulations, your extension "zotero-cite" is now active!');

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with  registerCommand
  // The commandId parameter must match the command field in package.json
  const commands = [
    {
      id: "zotero-cite.exportBibLatex",
      command: exportBibLatex,
    },
    {
      id: "zotero-cite.addCitation",
      command: addCitation,
    },
    {
      id: "zotero-cite.citeBibliography",
      command: citeBibliography,
    },
    {
      id: "zotero-cite.citeMarkdownBibliography",
      command: citeMarkdownBibliography,
    },
    {
      id: "zotero-cite.addHyperLinkCitation",
      command: addHyperLinkCitation,
    },
  ];

  commands.forEach((command) => {
    let disposable = vscode.commands.registerCommand(
      command.id,
      command.command
    );
    context.subscriptions.push(disposable);
  });
}

// this method is called when your extension is deactivated
function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
