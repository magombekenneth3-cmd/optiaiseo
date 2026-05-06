<?php
/**
 * Plugin Name:       OptiAISEO
 * Plugin URI:        https://optiaiseo.online
 * Description:       AI Visibility scoring in your WordPress editor. See your AEO score per post,
 *                    inject schema markup with one click, and track your brand's presence in
 *                    ChatGPT, Perplexity, and Google AI without leaving wp-admin.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      8.1
 * Author:            OptiAISEO
 * Author URI:        https://optiaiseo.online
 * License:           GPL v2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       optiaiseo
 * Domain Path:       /languages
 */

declare(strict_types=1);

namespace OptiAISEO;

// Prevent direct file access.
defined('ABSPATH') || exit;

// Guard against duplicate loading (e.g. mu-plugins + normal activation).
if (defined('OPTIAISEO_VERSION')) {
	return;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

define('OPTIAISEO_VERSION', '1.0.0');
define('OPTIAISEO_API_BASE', 'https://optiaiseo.online/api/wp');
define('OPTIAISEO_PLUGIN_FILE', __FILE__);
define('OPTIAISEO_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('OPTIAISEO_PLUGIN_URL', plugin_dir_url(__FILE__));

// ---------------------------------------------------------------------------
// PHP / WP version gate  (shown as an admin notice rather than a fatal error)
// ---------------------------------------------------------------------------

/**
 * Displays a dismissible admin notice when requirements are not met,
 * then bails out – no further plugin code is loaded.
 */
function optiaiseo_requirements_notice(): void
{
	$php_ok = version_compare(PHP_VERSION, '8.1', '>=');
	$wp_ok = version_compare($GLOBALS['wp_version'], '6.0', '>=');

	if ($php_ok && $wp_ok) {
		return; // All good – do not register the notice.
	}

	add_action(
		'admin_notices',
		static function () use ($php_ok, $wp_ok): void {
			$messages = [];
			if (!$php_ok) {
				$messages[] = sprintf(
					/* translators: 1: required PHP version, 2: current PHP version */
					esc_html__('OptiAISEO requires PHP %1$s or later. You are running %2$s.', 'optiaiseo'),
					'8.1',
					PHP_VERSION
				);
			}
			if (!$wp_ok) {
				$messages[] = sprintf(
					/* translators: 1: required WP version, 2: current WP version */
					esc_html__('OptiAISEO requires WordPress %1$s or later. You are running %2$s.', 'optiaiseo'),
					'6.0',
					$GLOBALS['wp_version']
				);
			}
			foreach ($messages as $message) {
				echo '<div class="notice notice-error"><p>' . esc_html($message) . '</p></div>';
			}
		}
	);
}

if (!version_compare(PHP_VERSION, '8.1', '>=') || !version_compare($GLOBALS['wp_version'] ?? '0', '6.0', '>=')) {
	optiaiseo_requirements_notice();
	return; // Stop loading the plugin.
}

// ---------------------------------------------------------------------------
// Autoload includes
// ---------------------------------------------------------------------------

$optiaiseo_includes = [
	'includes/class-admin.php',
	'includes/class-columns.php',
	'includes/class-schema.php',
	'includes/class-gutenberg.php',
];

foreach ($optiaiseo_includes as $optiaiseo_file) {
	$optiaiseo_path = OPTIAISEO_PLUGIN_DIR . $optiaiseo_file;
	if (!file_exists($optiaiseo_path)) {
		// Translators: %s – missing file path relative to the plugin root.
		add_action(
			'admin_notices',
			static function () use ($optiaiseo_file): void {
				printf(
					'<div class="notice notice-error"><p>%s</p></div>',
					esc_html(
						sprintf(
							/* translators: %s: relative file path */
							__('OptiAISEO: required file "%s" is missing. Please reinstall the plugin.', 'optiaiseo'),
							$optiaiseo_file
						)
					)
				);
			}
		);
		return; // Abort – plugin is incomplete.
	}
	require_once $optiaiseo_path;
}

unset($optiaiseo_includes, $optiaiseo_file, $optiaiseo_path);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

add_action('plugins_loaded', 'OptiAISEO\optiaiseo_init');

function optiaiseo_init(): void
{
	load_plugin_textdomain('optiaiseo', false, dirname(plugin_basename(OPTIAISEO_PLUGIN_FILE)) . '/languages');

	\OptiAISEO_Admin::init();
	\OptiAISEO_Columns::init();
	\OptiAISEO_Schema::init();
	\OptiAISEO_Gutenberg::init();
}

// ---------------------------------------------------------------------------
// Activation / Deactivation
// ---------------------------------------------------------------------------

register_activation_hook(OPTIAISEO_PLUGIN_FILE, 'OptiAISEO\optiaiseo_activate');

function optiaiseo_activate(): void
{
	if (!current_user_can('activate_plugins')) {
		return;
	}

	if (!wp_next_scheduled('optiaiseo_weekly_sync')) {
		wp_schedule_event(time(), 'weekly', 'optiaiseo_weekly_sync');
	}
}

register_deactivation_hook(OPTIAISEO_PLUGIN_FILE, 'OptiAISEO\optiaiseo_deactivate');

function optiaiseo_deactivate(): void
{
	if (!current_user_can('activate_plugins')) {
		return;
	}

	wp_clear_scheduled_hook('optiaiseo_weekly_sync');
}

// ---------------------------------------------------------------------------
// Scheduled sync
// ---------------------------------------------------------------------------

add_action('optiaiseo_weekly_sync', 'OptiAISEO\optiaiseo_sync_all_posts');

function optiaiseo_sync_all_posts(): void
{
	// Intentionally low per-page to stay within server time limits.
	$post_ids = get_posts([
		'post_type' => 'post',
		'post_status' => 'publish',
		'posts_per_page' => 50,
		'fields' => 'ids',
		'no_found_rows' => true, // Skip SQL_CALC_FOUND_ROWS; we don't need pagination meta.
	]);

	if (empty($post_ids)) {
		return;
	}

	foreach ($post_ids as $post_id) {
		optiaiseo_refresh_post_score((int) $post_id);
		sleep(2); // Polite rate-limit between API calls.
	}
}

// ---------------------------------------------------------------------------
// Core: fetch + persist score for a single post
// ---------------------------------------------------------------------------

/**
 * Calls the OptiAISEO API for a single post and stores the results as post meta.
 *
 * @param  int        $post_id  WordPress post ID.
 * @return array<string,mixed>|null  Decoded API body on success, null on any failure.
 */
function optiaiseo_refresh_post_score(int $post_id): ?array
{

	// --- Credential check ---------------------------------------------------
	$api_key = get_option('optiaiseo_api_key');
	$site_id = get_option('optiaiseo_site_id');

	if (empty($api_key) || empty($site_id)) {
		return null;
	}

	// --- Post URL -----------------------------------------------------------
	$post_url = get_permalink($post_id);
	if (empty($post_url)) {
		return null;
	}

	// --- Build request ------------------------------------------------------
	$payload = wp_json_encode([
		'siteId' => sanitize_text_field((string) $site_id),
		'postUrl' => esc_url_raw($post_url),
		'postId' => $post_id,
	]);

	if (false === $payload) {
		// json_encode failed – should never happen with these types, but be defensive.
		return null;
	}

	$response = wp_remote_post(
		OPTIAISEO_API_BASE . '/post-score',
		[
			'timeout' => 30,
			'user-agent' => 'OptiAISEO/' . OPTIAISEO_VERSION . '; ' . get_bloginfo('url'),
			'headers' => [
				'Authorization' => 'Bearer ' . sanitize_text_field($api_key),
				'Content-Type' => 'application/json',
				'Accept' => 'application/json',
			],
			'body' => $payload,
		]
	);

	// --- Response validation ------------------------------------------------
	if (is_wp_error($response)) {
		// Optional: log for debugging without exposing credentials.
		// error_log( '[OptiAISEO] API error for post ' . $post_id . ': ' . $response->get_error_message() );
		return null;
	}

	$http_code = (int) wp_remote_retrieve_response_code($response);
	if (200 !== $http_code) {
		return null;
	}

	$raw_body = wp_remote_retrieve_body($response);
	if (empty($raw_body)) {
		return null;
	}

	$body = json_decode($raw_body, true);
	if (!is_array($body) || JSON_ERROR_NONE !== json_last_error()) {
		return null;
	}

	// --- Persist meta (sanitise before storing) ----------------------------
	update_post_meta($post_id, '_optiaiseo_score', absint($body['aeoScore'] ?? 0));
	update_post_meta($post_id, '_optiaiseo_grade', sanitize_text_field($body['grade'] ?? 'F'));
	update_post_meta($post_id, '_optiaiseo_gsov', (float) ($body['generativeShareOfVoice'] ?? 0.0));
	update_post_meta($post_id, '_optiaiseo_checks', wp_json_encode(array_map('sanitize_text_field', (array) ($body['failedChecks'] ?? []))));
	update_post_meta($post_id, '_optiaiseo_schema_html', wp_kses_post($body['suggestedSchemaHtml'] ?? ''));
	update_post_meta($post_id, '_optiaiseo_synced_at', time());

	return $body;
}