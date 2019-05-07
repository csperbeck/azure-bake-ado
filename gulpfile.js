var gulp = require('gulp');
var es = require('event-stream');
var del = require('del');
var fs = require('fs');
var inlinesource = require('gulp-inline-source');
var argv = require('yargs').argv;
var moment = require('moment');
var sonarqubeScanner = require('sonarqube-scanner');

var IsRunningOnVsts = !!process.env.AGENT_ID;

function bumpVersion() {
	return es.map((file, cb) => {
		let taskJsonPath = file.history[0];
		if (taskJsonPath) {
			console.log("Bumping version for task: " + taskJsonPath);
			var taskJson = JSON.parse(fs.readFileSync(taskJsonPath));
			if (typeof taskJson.version.Patch != 'number') {
				fail(`Error processing '${name}'. version.Patch should be a number.`);
			}

			taskJson.version.Patch = taskJson.version.Patch + 1;
			fs.writeFileSync(taskJsonPath, JSON.stringify(taskJson, null, 4));
		}
		cb(null, file);
	});
}

gulp.task('bump-version', function () {
	return gulp.src(['tasks/**/task.json'])
		.pipe(bumpVersion())
});

gulp.task('clean-coverage', () => {
	return del('coverage/**', { force: true });
});

// write a list of filenames to a text file
// this sets up a file that includes all of the ts files, to ensure code coverage numbers include everything
function writeFilenameToFile() {
	let output = fs.createWriteStream(__dirname + '/app.spec.ts');
	output.write('// I am an automatically generated file. I help ensure that unit tests have accurate code coverage numbers. You can ignore me.\n\n')

	return es.map((file, cb) => {
		let name = file.history[0];
		if (name) {
			name = name.replace(__dirname + '.').replace(/\\/g, '/');
			output.write('require(\'' + name + '\');\n');
		}

		cb(null, file);
	});
}
gulp.task('setup-coverage-pool', function () {
	return gulp.src(['tasks/**/*.ts', '!tasks/**/tests.ts', '!tasks/**/node_modules/**/*'])
		.pipe(writeFilenameToFile())
});

// print a command for VSTS to pick up the build number
gulp.task('print-version', function () {
	let name = require('./package.json').version;

	if (process.env.BUILD_REASON === 'PullRequest') {
		// pull requests will be [version]_[source branch name]
		const branchName = process.env.SYSTEM_PULLREQUEST_SOURCEBRANCH;
		name += '_' + branchName.replace(/refs\/heads\/(feature\/)?/i, '');
	} else if (process.env.BUILD_SOURCEBRANCHNAME) {
		const branchName = process.env.BUILD_SOURCEBRANCH;

		if (branchName !== 'master') {
			// all branches have refs/heads/ - we don't need that
			// we will also remove feature/ if it's there
			name += '_' + branchName.replace(/refs\/heads\/(feature\/)?/i, '');
		}
	}

	// make sure no illegal characters are there
	name = name.replace(/\"|\/|:|<|>|\\|\|\?|\@|\*/g, '_');

	// add YYYYMMDD_HHmm to mark the date and time of this build
	name += `_${moment().format('YYYYMMDD.HHmm')}`;

	console.log('##vso[build.updatebuildnumber]' + name);
});

gulp.task('inline-coverage-source', function () {
	return gulp.src('./coverage/*.html')
		.pipe(inlinesource({ attribute: false }))
		.pipe(gulp.dest('./coverage/inline-html'));
});

//this task is meant to only run from VSTS builds, not local builds
gulp.task('analysis', done => {
	if (!IsRunningOnVsts) {
		console.log('Skipping SonarQube analysis for local build...');
		done();
	}
	else {

		let version = require('./package.json').version;

		//standard SonarQube configuration options
		let sonarOptions = {
			"sonar.projectName": "Azure-Bake-ADO",
			"sonar.projectKey": "azure-bake-ado",
			"sonar.typescript.lcov.reportPaths": "coverage/lcov.info",
			"sonar.projectVersion": version,
			//"sonar.cpd.exclusions": "src/index.html, dist/index.html",
			"sonar.coverage.exclusions": "**/*.spec.ts, gulpfile.js, karma.conf.js, protractor.conf.js, **/node_modules/*"
		};

		//get source branch name
		let sourceBranch = (process.env.BUILD_REASON === 'PullRequest') ? process.env.SYSTEM_PULLREQUEST_SOURCEBRANCH : process.env.BUILD_SOURCEBRANCH;
		sourceBranch = sourceBranch.replace(/refs\/heads\//i, '');

		//if running from a pull request, add the target branch option
		if (process.env.BUILD_REASON === 'PullRequest') {
			sonarOptions["sonar.branch.target"] = process.env.SYSTEM_PULLREQUEST_TARGETBRANCH.replace(/refs\/heads\//i, '');
		}

		//if not running on the master branch, add the source branch option
		if (sourceBranch != 'master') {
			sonarOptions["sonar.branch.name"] = sourceBranch
		}

		sonarqubeScanner({
			serverUrl: "https://sonarqube.hchb.com",
			token: argv.sonarToken,
			options: sonarOptions
		}, callback);
	}
});

gulp.task('pretest', gulp.series('clean-coverage', 'setup-coverage-pool'));

gulp.task('full:analysis', gulp.series('pretest', 'inline-coverage-source', 'analysis'));
