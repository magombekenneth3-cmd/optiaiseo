( function () {
	var registerPlugin = wp.plugins.registerPlugin;
	var PluginSidebar  = wp.editPost.PluginSidebar;
	var PluginSidebarMoreMenuItem = wp.editPost.PluginSidebarMoreMenuItem;
	var useSelect      = wp.data.useSelect;
	var useState       = wp.element.useState;
	var createElement  = wp.element.createElement;
	var Fragment       = wp.element.Fragment;
	var __             = wp.i18n.__;

	var data = window.optiaiseoData || {};
	var ajaxUrl      = data.ajaxUrl      || '';
	var nonces       = data.nonces       || {};
	var dashboardUrl = data.dashboardUrl || 'https://optiaiseo.online/dashboard';

	function gradeClass( grade ) {
		if ( ! grade ) return 'oaiseo-grade-f';
		return 'oaiseo-grade-' + grade.toLowerCase();
	}

	function OptiAISEOPanel() {
		var postId   = useSelect( function( s ) { return s( 'core/editor' ).getCurrentPostId(); } );
		var postMeta = useSelect( function( s ) { return s( 'core/editor' ).getEditedPostAttribute( 'meta' ) || {}; } );

		var score    = postMeta._optiaiseo_score    !== undefined ? Number( postMeta._optiaiseo_score )   : null;
		var grade    = postMeta._optiaiseo_grade    || null;
		var gsov     = postMeta._optiaiseo_gsov     !== undefined ? Number( postMeta._optiaiseo_gsov )    : null;
		var syncedAt = postMeta._optiaiseo_synced_at ? Number( postMeta._optiaiseo_synced_at ) : null;
		var hasSchema = !! postMeta._optiaiseo_injected_schema;
		var suggested = postMeta._optiaiseo_schema_html || '';

		var checks = [];
		try { checks = JSON.parse( postMeta._optiaiseo_checks || '[]' ); } catch ( e ) {}

		var refreshState  = useState( false );
		var refreshing    = refreshState[0];
		var setRefreshing = refreshState[1];

		var injectState  = useState( false );
		var injecting    = injectState[0];
		var setInjecting = injectState[1];

		var noticeState  = useState( null );
		var notice       = noticeState[0];
		var setNotice    = noticeState[1];

		function showNotice( type, message ) {
			setNotice( { type: type, message: message } );
			setTimeout( function() { setNotice( null ); }, 4000 );
		}

		function doRefresh() {
			setRefreshing( true );
			setNotice( null );
			var body = new URLSearchParams( {
				action:  'optiaiseo_refresh_post',
				nonce:   nonces.refresh || '',
				post_id: postId,
			} );
			fetch( ajaxUrl, { method: 'POST', body: body } )
				.then( function( r ) { return r.json(); } )
				.then( function( d ) {
					if ( d.success ) {
						showNotice( 'success', __( 'Score refreshed!', 'optiaiseo' ) );
						wp.data.dispatch( 'core/editor' ).editPost( { meta: {
							_optiaiseo_score:       String( d.data.aeoScore                    || 0  ),
							_optiaiseo_grade:       d.data.grade                               || 'F',
							_optiaiseo_gsov:        String( d.data.generativeShareOfVoice      || 0  ),
							_optiaiseo_checks:      JSON.stringify( d.data.failedChecks         || [] ),
							_optiaiseo_schema_html: d.data.suggestedSchemaHtml                 || '',
							_optiaiseo_synced_at:   String( Math.floor( Date.now() / 1000 )        ),
						} } );
					} else {
						showNotice( 'error', ( d.data && d.data.message ) || __( 'Refresh failed.', 'optiaiseo' ) );
					}
				} )
				.catch( function() { showNotice( 'error', __( 'Network error. Try again.', 'optiaiseo' ) ); } )
				.finally( function() { setRefreshing( false ); } );
		}

		function doInjectSchema() {
			if ( ! suggested ) {
				showNotice( 'warning', __( 'No schema suggestion yet — refresh the score first.', 'optiaiseo' ) );
				return;
			}
			setInjecting( true );
			var body = new URLSearchParams( {
				action:  'optiaiseo_inject_schema',
				nonce:   nonces.schema || '',
				post_id: postId,
			} );
			fetch( ajaxUrl, { method: 'POST', body: body } )
				.then( function( r ) { return r.json(); } )
				.then( function( d ) {
					if ( d.success ) {
						showNotice( 'success', __( 'Schema injected into <head>.', 'optiaiseo' ) );
						wp.data.dispatch( 'core/editor' ).editPost( { meta: {
							_optiaiseo_injected_schema: suggested,
						} } );
					} else {
						showNotice( 'error', ( d.data && d.data.message ) || __( 'Injection failed.', 'optiaiseo' ) );
					}
				} )
				.catch( function() { showNotice( 'error', __( 'Network error.', 'optiaiseo' ) ); } )
				.finally( function() { setInjecting( false ); } );
		}

		var ageStr = syncedAt ? new Date( syncedAt * 1000 ).toLocaleDateString() : null;

		return createElement( PluginSidebar, { name: 'optiaiseo-panel', title: __( 'AI Visibility (OptiAISEO)', 'optiaiseo' ), icon: '📊' },

			notice && createElement( 'div', { style: { padding: '8px 16px' } },
				createElement( wp.components.Notice, { status: notice.type, isDismissible: false }, notice.message )
			),

			score !== null
				? createElement( 'div', { className: 'oaiseo-score-row' },
					createElement( 'div', { className: 'oaiseo-big-score' }, score ),
					grade && createElement( 'span', { className: 'oaiseo-grade-pill ' + gradeClass( grade ) }, grade ),
					gsov !== null && createElement( 'span', { style: { fontSize: 11, color: '#757575', marginLeft: 'auto' } }, 'gSOV ', gsov, '%' )
				)
				: createElement( 'div', { className: 'oaiseo-empty' }, __( 'Not scored yet — click Refresh below.', 'optiaiseo' ) ),

			ageStr && createElement( 'div', { style: { fontSize: 11, color: '#999', padding: '4px 16px 8px' } },
				__( 'Last synced: ', 'optiaiseo' ), ageStr
			),

			checks.length > 0 && createElement( 'div', {},
				createElement( 'div', { style: { fontWeight: 600, fontSize: 11, padding: '8px 16px 4px', color: '#3c434a', borderTop: '1px solid #e0e0e0' } },
					__( 'Failing checks', 'optiaiseo' )
				),
				checks.slice( 0, 6 ).map( function( c, i ) {
					return createElement( 'div', { key: i, className: 'oaiseo-check' },
						createElement( 'span', { className: 'oaiseo-check-fail' }, '✕' ),
						createElement( 'span', {}, c.label || c )
					);
				} )
			),

			createElement( 'div', { style: { padding: '8px 16px', borderTop: '1px solid #e0e0e0', fontSize: 11, color: hasSchema ? '#007a1f' : ( suggested ? '#c45800' : '#cc1818' ) } },
				hasSchema  ? '✓ ' + __( 'Schema markup injected', 'optiaiseo' )
				: suggested ? '! ' + __( 'Schema suggestion available', 'optiaiseo' )
				:            '✕ ' + __( 'No schema markup', 'optiaiseo' )
			),

			createElement( 'div', { className: 'oaiseo-actions' },
				createElement( 'button', { className: 'oaiseo-btn', onClick: doRefresh, disabled: refreshing },
					refreshing ? __( '⟳ Refreshing…', 'optiaiseo' ) : '⟳ ' + __( 'Refresh score', 'optiaiseo' )
				),
				! hasSchema && suggested && createElement( 'button', { className: 'oaiseo-btn oaiseo-btn-primary', onClick: doInjectSchema, disabled: injecting },
					injecting ? __( 'Injecting…', 'optiaiseo' ) : '+ ' + __( 'Inject schema markup', 'optiaiseo' )
				),
				createElement( 'a', { href: dashboardUrl + '/aeo', target: '_blank', rel: 'noopener noreferrer', style: { fontSize: 11, color: '#2271b1', textDecoration: 'none', paddingTop: 4 } },
					__( 'Full AEO report →', 'optiaiseo' )
				)
			)
		);
	}

	registerPlugin( 'optiaiseo', {
		icon: '📊',
		render: function() {
			return createElement( Fragment, {},
				createElement( PluginSidebarMoreMenuItem, { target: 'optiaiseo-panel' }, __( 'AI Visibility (OptiAISEO)', 'optiaiseo' ) ),
				createElement( OptiAISEOPanel )
			);
		},
	} );
} )();
