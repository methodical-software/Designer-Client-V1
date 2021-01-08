import React from 'react';
import { Button } from 'semantic-ui-react';
import { useMutation } from '@apollo/client';
import {
	CREATE_LINK, CREATE_NODE, DELETE_LINK, DELETE_LINK_END, DELETE_NODE, DELETE_SEQUENCE, MERGE_LINK_END, MERGE_SEQUENCE,
	UPDATE_LINK, UPDATE_NODE, FREE_EDITING_RIGHTS,
} from '../queries/ServerMutations';
import { deleteLinkOrNode, handleLinkEnds, handleSequence } from '../TransactionUtils';
import LoadingMessage from './LoadingMessage';
import { addLogMessage, setActiveItem } from '../utils';
import withLocalDataAccess from '../HOCs/withLocalDataAccess';
import '../css/SavePane.css';

const SavePane = ( {
										 props, getDeletedLinks, getDeletedNodes, getEditedLinks, getEditedNodes,
										 getCreatedLinks, getCreatedNodes, hasUnsavedLocalChanges, editingData,
									 } ) => {
	const { client, getNodes, getLinks } = props;

	const [ runCreateNode, { loading: nodeCreateLoading } ] = useMutation( CREATE_NODE );
	const [ runUpdateNode, { loading: nodeUpdateLoading } ] = useMutation( UPDATE_NODE );
	const [ runCreateLink, { loading: createLinkLoading } ] = useMutation( CREATE_LINK );
	const [ runUpdateLink, { loading: updateLinkLoading } ] = useMutation( UPDATE_LINK );
	const [ runDeleteNode, { loading: deleteNodeLoading } ] = useMutation( DELETE_NODE );
	const [ runDeleteLink, { loading: deleteLinkLoading } ] = useMutation( DELETE_LINK );
	const [ runMergeSeq, { loading: mergeSeqLoading } ] = useMutation( MERGE_SEQUENCE );
	const [ runDeleteSeq, { loading: deleteSeqLoading } ] = useMutation( DELETE_SEQUENCE );
	const [ runMergeLinkEnd, { loading: mergeLinkEndLoading } ] = useMutation( MERGE_LINK_END );
	const [ runDeleteLinkEnd, { loading: deleteLinkEndLoading } ] = useMutation( DELETE_LINK_END );

	const [ freeEditingRights ] = useMutation( FREE_EDITING_RIGHTS );
	window.addEventListener( 'beforeunload', function( e ) {
		if ( editingData.hasEditRights ) {
			freeEditingRights()
				.catch( err => addLogMessage( client, 'Error when freeing editing rights after leaving page: ' + err.message ) );
		}
	} );
	window.addEventListener( 'onunload', function( e ) {
		if ( editingData.hasEditRights ) {
			freeEditingRights()
				.catch( err => addLogMessage( client, 'Error when freeing editing rights after leaving page: ' + err.message ) );
		}
	} );

	const handleDiscard = e => {
		e.stopPropagation();
		setActiveItem( client, 'app', 'app' );
		getNodes();
		getLinks();
	};

	const handleSave = e => {
		e.stopPropagation();
		const createdNodes = getCreatedNodes();
		const editedNodes = getEditedNodes();

		const createdLinks = getCreatedLinks();
		const editedLinks = getEditedLinks();

		const deletedNodes = getDeletedNodes();
		const deletedLinks = getDeletedLinks();

		let nodePromises = [];
		let createLinkPromises = [];
		let createLinkEndAndSeqPromises = [];
		let editedLinkPromises = [];
		let editedLinkEndAndSeqPromises = [];
		let deleteLinkPromises = [];
		let deleteNodePromises = [];

		/*		the order for manipulating the DB is the following and it must be followed to avoid errors:
		 1. Create new nodes and update existing nodes
		 2. Create new links
		 3. Create Link ends and sequences on these newly created links
		 4. Update existing links
		 5. Create/Update/Delete link ends and sequences on edited links
		 6. Delete links
		 7. Delete Nodes
		 */
		addLogMessage( client, `saving created nodes` );
		for ( let node of createdNodes ) {
			const { id, label, story, synchronous, nodeType, unreliable } = node;
			const variables = { id, label, nodeType, props: { story, synchronous, unreliable } };
			nodePromises.push( runCreateNode( { variables } ) );
		}
		addLogMessage( client, `saving updated nodes` );
		for ( let node of editedNodes ) {
			const { id, label, story, synchronous, nodeType, unreliable } = node;
			const variables = { id, props: { label, nodeType, story, synchronous, unreliable } };
			nodePromises.push( runUpdateNode( { variables } ) );
		}

		Promise.all( nodePromises )
			.then( () => {
				addLogMessage( client, `finished creating and updating nodes, will now handle created links` );
				for ( let link of createdLinks ) {
					const { id, name: label, linkType, x: { id: x_id }, y: { id: y_id }, story, optional } = link;
					const variables = { id, label, linkType, x_id, y_id, props: { story, optional } };
					createLinkPromises.push( runCreateLink( { variables } ) );
				}
				Promise.all( createLinkPromises )
					.then( () => {
						addLogMessage( client, `finished creating links, will now handle sequences and link ends` );
						for ( let link of createdLinks ) {
							handleSequence( client, link, createLinkEndAndSeqPromises, runMergeSeq, runDeleteSeq );
							handleLinkEnds( client, link, createLinkEndAndSeqPromises, runMergeLinkEnd, runDeleteLinkEnd );
						}

						Promise.all( createLinkEndAndSeqPromises )
							.then( () => {
								addLogMessage( client, `finished sequences and link ends, will now handle edited links` );
								for ( let link of editedLinks ) {
									const { id, name: label, linkType, x: { id: x_id }, y: { id: y_id }, story, optional } = link;
									const variables = { id, props: { story, optional, label, linkType, x_id, y_id } };
									editedLinkPromises.push( runUpdateLink( { variables } ) );
								}

								Promise.all( editedLinkPromises )
									.then( () => {
										addLogMessage( client, `finished saving edited links, will now handle sequences and link ends` );
										for ( let link of editedLinks ) {
											handleSequence( client, link, editedLinkEndAndSeqPromises, runMergeSeq, runDeleteSeq );
											handleLinkEnds( client, link, editedLinkEndAndSeqPromises, runMergeLinkEnd, runDeleteLinkEnd );
										}

										Promise.all( editedLinkEndAndSeqPromises )
											.then( () => {
												addLogMessage( client, `finished sequences and link ends, will now delete links` );
												for ( let link of deletedLinks ) {
													deleteLinkOrNode( client, link, deleteLinkPromises, runDeleteLink );
												}

												Promise.all( deleteLinkPromises )
													.then( () => {
														addLogMessage( client, `finished deleting links, will now delete nodes` );
														for ( let node of deletedNodes ) {
															deleteLinkOrNode( client, node, deleteNodePromises, runDeleteNode );
														}

														Promise.all( deleteNodePromises )
															.then( () => {
																addLogMessage( client, `finished deleting nodes, will now reset local store` );
																getNodes();
																getLinks();

															} ).catch( reason => addLogMessage( client, `failed deleting nodes because of ${ reason }` ) );
													} ).catch( reason => addLogMessage( client, `failed deleting link because of ${ reason }` ) );
											} ).catch( reason => addLogMessage( client, `failed updating sequence/link end because of ${ reason }` ) );
									} ).catch( reason => addLogMessage( client, `failed updating link because of ${ reason }` ) );
							} ).catch( reason => addLogMessage( client, `failed creating sequence/link end because of ${ reason }` ) );
					} ).catch( reason => addLogMessage( client, `failed creating link because of ${ reason }` ) );
			} ).catch( reason => addLogMessage( client, `failed saving/updating node because of ${ reason }` ) );
	};
	const saveRender = () => {
		if ( nodeCreateLoading ) {
			return <LoadingMessage message='Step 1/10'/>;
		}
		else if ( nodeUpdateLoading ) {
			return <LoadingMessage message='Step 2/10'/>;
		}
		else if ( createLinkLoading ) {
			return <LoadingMessage message='Step 3/10'/>;
		}
		else if ( updateLinkLoading ) {
			return <LoadingMessage message='Step 4/10'/>;
		}
		else if ( deleteNodeLoading ) {
			return <LoadingMessage message='Step 5/10'/>;
		}
		else if ( deleteLinkLoading ) {
			return <LoadingMessage message='Step 6/10'/>;
		}
		else if ( mergeSeqLoading ) {
			return <LoadingMessage message='Step 7/10'/>;
		}
		else if ( deleteSeqLoading ) {
			return <LoadingMessage message='Step 8/10'/>;
		}
		else if ( mergeLinkEndLoading ) {
			return <LoadingMessage message='Step 9/10'/>;
		}
		else if ( deleteLinkEndLoading ) {
			return <LoadingMessage message='Step 10/10'/>;
		}

		return <Button color='grey' disabled={ disableButton() } className='save-button' onClick={ handleSave }>Save</Button>;
	};

	const disableButton = () => {
		// save button should be disable if the user has no edit rights, or no local changes that need to be saved
		return !editingData.hasEditRights || !hasUnsavedLocalChanges();
	};

	return (
		<div className='save-area'>
			{ saveRender() }
			<Button color='grey' disabled={ disableButton() } className='discard-button' onClick={ handleDiscard }>Discard
				Local Changes</Button>
		</div>
	);
};

export default withLocalDataAccess( SavePane );
