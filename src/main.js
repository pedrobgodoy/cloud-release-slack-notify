const httpm = require('@actions/http-client');
const github = require('@actions/github');
const core = require('@actions/core');
const fs = require('fs');
const path = require('path');

async function run() {
    try {
        const serviceName = getServiceName();
        const changeLogPath = core.getInput('change-log-path');
        const webhookUrl = process.env.SLACK_WEBHOOK_URL;
        const markdown = readChangeLog(changeLogPath);
        const versions = parseMarkdown(markdown);
        const latestVersion = versions[0];
        const blocks = versionToBlocks(latestVersion);
        addHeader(blocks, serviceName);
        await sendMessage(blocks, webhookUrl);
    } catch (error) {
        console.error(error);
        core.setFailed(error.message);
    }
}

function readChangeLog(filename) {
    return fs.readFileSync(path.resolve(process.cwd(), filename), 'utf8');
}

function getServiceName() {
    const inputServiceName = core.getInput('service-name');
    if (inputServiceName) {
        return inputServiceName;
    }
    const repoName = github.context.repo.repo;
    return repoName
        .split('-')
        .join(' ')
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

async function sendMessage(blocks, webhookUrl) {
    try {
        const http = new httpm.HttpClient();
        const response = await http.post(webhookUrl, JSON.stringify({ blocks }));
        if (response.message.statusCode !== 200) {
            core.setFailed(`Request failed with status code ${response.message.statusCode}`);
        }
        response.message.destroy();
    } catch (error) {
        core.setFailed(error.message);
    }
}

/**
 * Parse markdown to versions
 * @param {string} markdown
 * @returns {Version[]}
 */
function parseMarkdown(markdown) {
    const versions = [];
    const lines = markdown.split('\n');
    const elements = [];
    for (const line of lines) {
        if (line.startsWith('# [') || line.startsWith('## [')) {
            const version = line.match(/# \[(.*?)\]/)[1];
            const date = line.match(/\d{4}-\d{2}-\d{2}/)[0];
            const url = line.match(/\((.*?)\)/)[1];
            elements.push({ type: 'Header', raw: line, version, date, url });
        }
        if (line.match(/^# \d+.\d+.\d+/)) {
            const version = line.match(/# (.*?) /)[1];
            const date = line.match(/\d{4}-\d{2}-\d{2}/)[0];
            elements.push({ type: 'Header', raw: line, version, date });
        }
        if (line.startsWith('### ')) {
            const title = line.replace('### ', '');
            elements.push({ type: 'Section', raw: line, title });
        }
        if (line.startsWith('* ')) {
            let item = line
                .replaceAll('**', '')
                .replaceAll('* ', '')
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;');
            let itemCpy = item;
            const links = item.match(/\[(.*?)\]\((.*?)\)/g);
            const sections = [];
            for (const link of links ?? []) {
                const url = link.match(/\((.*?)\)/)[1];
                const text = link.match(/\[(.*?)\]/)[1];

                const [before, after] = itemCpy.split(link);
                sections.push({ type: 'Text', text: before });
                sections.push({ type: 'Link', raw: link, url, text });
                itemCpy = after;
            }
            sections.push({ type: 'Text', text: itemCpy });

            elements.push({ type: 'Item', raw: line, sections });
        }
    }

    let currentVersion = {
        header: {
            version: '',
            date: '',
            url: '',
        },
        sections: [],
    };
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        if (element.type === 'Header') {
            currentVersion = {
                header: {
                    version: element.version,
                    date: element.date,
                    url: element.url,
                },
                sections: [],
            };
            versions.push(currentVersion);
        }
        if (element.type === 'Section') {
            const section = {
                title: element.title,
                items: [],
            };
            currentVersion.sections.push(section);
        }
        if (element.type === 'Item') {
            const section = currentVersion.sections[currentVersion.sections.length - 1];
            section.items.push({ item: element.item, sections: element.sections });
        }
    }

    return versions;
}

/**
 * Map version to slack blocks
 * @param {Version} version
 * @returns {Object[]}
 */
function versionToBlocks(version) {
    const blocks = [];
    if (version.header.url) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `<${version.header.url}|${version.header.version}> (${version.header.date})`,
            },
        });
    } else {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `${version.header.version} (${version.header.date})`,
            },
        });
    }
    for (const section of version.sections) {
        blocks.push({
            type: 'rich_text',
            elements: [
                {
                    type: 'rich_text_section',
                    elements: [
                        {
                            type: 'text',
                            text: `${section.title}\n`,
                            style: {
                                bold: true,
                            },
                        },
                    ],
                },
                {
                    type: 'rich_text_list',
                    style: 'bullet',
                    elements: [
                        ...section.items.map((item) => ({
                            type: 'rich_text_section',
                            elements: [
                                ...item.sections.map((section) => {
                                    if (section.type === 'Text') {
                                        return {
                                            type: 'text',
                                            text: section.text,
                                        };
                                    }
                                    if (section.type === 'Link') {
                                        return {
                                            type: 'link',
                                            url: section.url,
                                            text: section.text,
                                        };
                                    }
                                }),
                            ],
                        })),
                    ],
                },
            ],
        });
    }
    return blocks;
}

/**
 *
 * @param {Object[]} blocks
 */
function addHeader(blocks, serviceName) {
    const header = [
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: `Release Note - ${serviceName}`,
            },
        },
    ];
    blocks.unshift(...header);
}

module.exports = {
    run,
};
