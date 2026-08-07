<?php

/*
*   --------
*/

namespace Deployer;

if ('cli' !== PHP_SAPI) {
    throw new \Exception('The deployer configuration must be used in cli.');
}

/*
*   Deployment-Host-Konfiguration
*/

$deploymentName = '{{PROJECT_NAME}}';
$deploymentHost = 'example.com';
$deploymentPort = '22';
$deploymentUser = 'benutzername';
$deploymentType = 'production';
$deploymentPath = '/httpdocs';
$deploymentRepository = 'git@github.com:user/repo.git';
// es muss nicht zwingend ein Git-Repository verwendet werden; dieses Skript prueft, ob ein Git-Repository initialisiert wurde.
// ohne Git-Repository muss ggf. der `deploy:update_code`-Task in dieser Datei angepasst werden (ab Zeile 105)

$removeOnRelease = [
    'docs',
    'public/dist/assets/img/.gitkeep',
    '.browserslistrc',
    '.env',
    '.env.local',
    '.npmrc',
    '.prettierrc',
    '.vite-reload-trigger',
    'biome.jsonc',
    'bun.lock',
    'bun.lockb',
    'CLAUDE.md',
    'composer.json',
    'composer.lock',
    'deploy.php',
{{DEPLOYER_EXTRAS_CLEAR_PATHS}}
    'deployer.task.setup.php',
    'jsconfig.json',
    'localhost+2-key.pem',
    'localhost+2.pem',
    'LocalValetDriver.php',
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'stylelint.config.js',
    'tailwind.config.js',
    'vite.config.js',
    'yarn.lock',
    '.yarn',
];

// -------------------------------------------------

require __DIR__ . '/src/addons/ydeploy/deploy_yak.php';
require __DIR__ . '/deployer.task.setup.php';
{{DEPLOYER_EXTRAS}}

$isGit = is_dir(__DIR__ . '/.git');

set(
    'bin/php',
    function () {
        return '$HOME/Library/Application\ Support/Herd/bin/php';
    }
);

// The build runs on host('local') (see ydeploy's deploy task), so the package
// manager chosen at scaffold time is normally present. The chain below is a
// fallback only — e.g. when a teammate without that PM deploys.
set('assets_install', static function () {
    if (!test('[ -f {{release_path}}/package.json ]')) {
        return false;
    }
    if (commandExist('{{PACKAGE_MANAGER}}')) {
        return '{{PACKAGE_MANAGER}} install';
    }
    warning('{{PACKAGE_MANAGER}} not found — falling back to the first available package manager');
    foreach (['bun', 'pnpm', 'yarn', 'npm'] as $pm) {
        if (commandExist($pm)) {
            return $pm . ' install';
        }
    }

    return false;
});

set('assets_build', static function () {
    if (!get('assets_install')) {
        return false;
    }

    if (!test('[ -f {{release_path}}/webpack.config.js ]') && test('[ -d {{release_path}}/gulpfile.js ]')) {
        return 'APP_ENV=prod node_modules/.bin/gulp build';
    }

    if (commandExist('{{PACKAGE_MANAGER}}')) {
        return '{{PACKAGE_MANAGER}} run build';
    }
    foreach (['bun', 'pnpm', 'yarn', 'npm'] as $pm) {
        if (commandExist($pm)) {
            return $pm . ' run build';
        }
    }

    return false;
});

add('shared_dirs', [
    '{{data_dir}}/addons/statistics'
]);

add('clear_paths', $removeOnRelease);

set('update_code_strategy', 'clone');

desc('Copy files for local build');
task('build:vendors', static function () {
    info('Copying files for local build ...');
    on(
        host('local'),
        // copy files for local build
        static function () {
            if (test('[ -d public/dist ]')) {
                run('cp -r public/dist {{release_path}}/public/');
            }
            run('cp .env.local {{release_path}}');
            run('cp .env.local {{release_path}}/.env');
            if (test('[ -f localhost+2-key.pem ]') && test('[ -f localhost+2.pem ]')) {
                run('cp localhost+2-key.pem {{release_path}}');
                run('cp localhost+2.pem {{release_path}}');
            }
            // install Git submodules if they exist
            if (test('[ -f {{release_path}}/.gitmodules ]')) {
                info('Installing Git submodules');
                run('cd {{release_path}} && git submodule update --init --recursive');
                info('Git submodules installed');
                // get submodule paths
                $submodulePaths = run('cd {{release_path}} && git config --file .gitmodules --get-regexp path | awk \'{ print $2 }\'');
                $submodulePaths = explode("\n", $submodulePaths);
                foreach ($submodulePaths as $path) {
                    // run composer install in each submodule
                    if (test("[ -f {{release_path}}/$path/composer.json ]")) {
                        info("Running composer install in submodule: $path");
                        run("cd {{release_path}}/$path && composer install --no-dev --optimize-autoloader");
                    }
                    // remove .git directory from submodules
                    if (test("[ -d {{release_path}}/$path/.git ]")) {
                        info("Removing .git directory from submodule: $path");
                        run("rm -rf {{release_path}}/$path/.git");
                    }
                    if (test("[ -d {{release_path}}/$path/.github ]")) {
                        info("Removing .github directory from submodule: $path");
                        run("rm -rf {{release_path}}/$path/.github");
                    }
                }
            } else {
                info('No Git submodules found in {{release_path}}/.gitmodules');
            }
            // Remove git
            run('rm -rf {{release_path}}/.git && rm -rf {{release_path}}/.gitmodules');
        }
    );
});

// delete shared/media directory if it exists
before('deploy:success', function () {
    if (test('[ -d {{deploy_path}}/shared/media ]')) {
        run('rm -rf {{deploy_path}}/shared/media');
    }
    info('Copying files back from deplyoment build ...');
    on(
        host('local'),
        static function () {
            run('cp -r {{release_path}}/public/dist public/');
        }
    );
});

// Hosts
host($deploymentName)
    ->setHostname($deploymentHost)
    ->setRemoteUser($deploymentUser)
    ->setPort($deploymentPort)
    ->set('http_user', 'benutzername')
    ->set('labels', ['stage' => $deploymentType])
    ->set(
        'bin/php',
        function () {
            return run('which php');
        }
    )
    ->setDeployPath($deploymentPath);

if ($isGit) {
    set('repository', $deploymentRepository);
    set('branch', static fn() => runLocally('{{bin/git}} rev-parse --abbrev-ref HEAD'));
} else {
    set('branch', 'main');

    desc('Updates code');
    task('deploy:update_code', function () {
        foreach (
            [
                'bin',
                'public',
                'src',
                'var',
                'LICENSE.md',
            ] as $src
        ) {
            upload($src, '{{release_path}}/', ['options' => ['--recursive', '--relative']]);
        }
        cd('{{release_path}}/var/data/core');
        run('mv config.yml default.config.yml');
    });

    desc('Dump info about current deployment');
    task('deploy:dump_info', static function () {
        $host = get('alias');
        $stage = get('labels')['stage'] ?? null;

        if (null === $stage && in_array($host, ['staging', 'test', 'testing', 'live', 'prod', 'production'], true)) {
            $stage = $host;
        }

        $infos = [
            'host' => $host,
            'stage' => $stage,
            'stage' => 'local',
            'commit' => 'none',
            'timestamp' => time(),
        ];

        $infos = json_encode($infos, JSON_PRETTY_PRINT);

        run('mkdir -p {{release_path}}/{{data_dir}}/addons/ydeploy');
        run('echo ' . escapeshellarg($infos) . ' > {{release_path}}/{{data_dir}}/addons/ydeploy/info.json');
    });
}
