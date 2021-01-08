import React, { useState } from 'react';
import { useApolloClient, useMutation } from '@apollo/client';
import { Message, Button } from 'semantic-ui-react';
import { FREE_EDITING_RIGHTS, REQUEST_EDITING_RIGHTS } from '../queries/ServerMutations';
import { EDITING_RIGHTS } from '../queries/LocalQueries';
import { addLogMessage, writeToCache } from '../utils';
import withLocalDataAccess from '../HOCs/withLocalDataAccess';
import '../css/ProjectStatus.css';

const ProjectStatus = ( { props, hasUnsavedLocalChanges, editingData } ) => {
	const { getNodes, getLinks } = props;
	const client = useApolloClient();

	const [ negativeRequest, setNegativeRequest ] = useState( false );

	const [ runFreeRights ] = useMutation( FREE_EDITING_RIGHTS, {
		update: ( cache, { data: { FreeEditRights } } ) => {
			// inverted because operation will return true if freeing worked
			writeToCache( client, cache, EDITING_RIGHTS, { hasEditRights: !FreeEditRights.success },
				'Error when writing editing rights to the cache in runFreeRights in project status' );
		},
		onError: err => addLogMessage( client, 'Error when freeing rights: ' + err.message ),
	} );

	const [ runRequestRights ] = useMutation( REQUEST_EDITING_RIGHTS, {
		update: ( cache, { data: { RequestEditRights } } ) => {
			if ( RequestEditRights.success ) {
				getNodes();
				getLinks();
				setNegativeRequest( false );
			}
			else {
				setNegativeRequest( true );
			}
			cache.writeQuery( {
				query: EDITING_RIGHTS,
				data: { hasEditRights: RequestEditRights.success },
			} );
		},
		onError: err => addLogMessage( client, 'Error when requesting rights: ' + err.message ),
	} );

	const handleFreeRights = ( e ) => {
		e.stopPropagation();
		if ( hasUnsavedLocalChanges() ) {
			alert( 'Please first save local changes to the DB' );
		}
		else {
			runFreeRights()
				.catch( err => addLogMessage( client, `Failed when freeing rights: ` + err.message ) );
		}
	};

	const handleRequestEditRights = ( e ) => {
		e.stopPropagation();
		runRequestRights()
			.then( ( { data } ) => {
				const { RequestEditRights } = data;
				if ( !RequestEditRights.success ) {
					addLogMessage( client, 'Error when requesting rights: ' + RequestEditRights.message.toString() );
				}
			} )
			.catch( err => addLogMessage( client, `Failed when requesting rights: ` + err.message ) );
	};

	const handleForceRights = ( e ) => {
		e.stopPropagation();
		runFreeRights()
			.then( res => runRequestRights()
				.catch( err => addLogMessage( client, `Failed when requesting rights: ` + err.message ) ) )
			.catch( err => addLogMessage( client, `Failed when freeing rights: ` + err.message ) );
	};

	if ( editingData ) {
		if ( !editingData.hasEditRights ) {
			const contentText = negativeRequest ? 'Another user has editing rights.' : 'You have no editing rights yet.';

			return (
				<div className='rights-pane'>
					<Message warning className='rights-message'>
						<Message.Header>No Editing Rights</Message.Header>
						<Message.Content className='rights-info'>{ contentText }</Message.Content>
					</Message>
					<Button color='teal' className='rights-button' onClick={ handleRequestEditRights }>Request Now</Button>
					{ negativeRequest &&
					<Button color='red' className='force-button' onClick={ handleForceRights }>Force Rights</Button> }
				</div>
			);
		}
		else {
			return (
				<div className='rights-pane'>
					<Message positive className='rights-message'>
						<Message.Header>You have editing rights!</Message.Header>
						<Message.Content className='rights-info'>Feel free to make changes</Message.Content>
					</Message>
					<Button color='teal' className='rights-button' onClick={ handleFreeRights }>Free Editing Rights</Button>
				</div>
			);
		}
	}
};

export default withLocalDataAccess( ProjectStatus );