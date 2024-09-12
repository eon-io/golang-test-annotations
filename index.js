const core = require('@actions/core');
const lineReader = require('line-by-line');
const fs = require('fs');


try {
	const testResultsPath = core.getInput('test-results');;

	if (!fs.existsSync(testResultsPath)) {
		core.warning(
			`No file was found with the provided path: ${testResultsPath}.`
		)
		return
	}

	let obj = {};
	let lr = new lineReader(testResultsPath);
	lr.on('line', function (line) {
		const currentLine = JSON.parse(line);
		const testName = currentLine.Test;
		if (typeof testName === "undefined") {
			return;
		}

		// Strip github.com/owner/repo package from the path by default
		let packageName = currentLine.Package.split("/").slice(3).join("/");
        let key = packageName + "/" + testName;
        if (currentLine.Action === "output") {
            let output = currentLine.Output;
            if (typeof output === "undefined") {
                return;
            }
            // output = output.replace("\n", "%0A").replace("\r", "%0D")
            if (/^(=== RUN|\s*--- (FAIL|PASS): )/.test(output ?? '')) {
                return;
            }
            obj[key] ??= { output: [] };
            obj[key].output.push(output);
        }
        if (currentLine.Action === "fail") {
            obj[key] ??= { output: [] };
            obj[key].status = "FAIL";
        }
	});
	lr.on('end', function () {
        const messages = [];
		for (const [key, { output, status }] of Object.entries(obj)) {
			if (status !== "FAIL") {
                return;
			}
            let current
            for (const line of output) {
                // ^(?:.*\s+|\s*) - non-greedy match of any chars followed by a space or, a space.
                // (?<file>\S+\.go):(?<line>\d+):  - gofile:line: followed by a space.
                // (?<message>.\n)$ - all remaining message up to $.
                const m = line.match(/^.*\s+(?<file>\S+\.go):(?<line>\d+): (?<message>.*\n)$/);
                if (m?.groups) {
                    const file = m.groups.file;
                    const ln = Number(m.groups.line) - 1; // VSCode uses 0-based line numbering (internally)
                    current = { file ,ln };
                    messages.push({ message: m.groups.message, location: current });
                } else if (current) {
                    messages.push({ message: line, location: current });
                }
            }
		}
        const merged = new Map();
        for (const { message, location } of messages) {
            const loc = `${location?.file}:${location?.ln}`;
            if (merged.has(loc)) {
                merged.get(loc).message += '' + message;
            } else {
                merged.set(loc, { message, location });
            }
        }
        [...merged.values()].forEach(({ message, location }) => {
			core.info(`::error file=${location.file},line=${location.ln}::${message}`);
        });
	});
} catch (error) {
	core.setFailed(error.message);
}
