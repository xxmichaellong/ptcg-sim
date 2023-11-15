const rootDirectory = window.location.origin;

const cardData = [
    [4, 'comfey', rootDirectory + '/resources/card-scans/comfey.webp', 'pokemon'],
    [2, 'sableye', rootDirectory + '/resources/card-scans/sableye.webp', 'pokemon'],
    [1, 'cramorant', rootDirectory + '/resources/card-scans/cramorant.webp', 'pokemon'],
    [1, 'kyogre', rootDirectory + '/resources/card-scans/kyogre.webp', 'pokemon'],
    [1, 'pidgeotV', rootDirectory + '/resources/card-scans/pidgeotV.webp', 'pokemon'],
    [1, 'manaphy', rootDirectory + '/resources/card-scans/manaphy.webp', 'pokemon'],
    [1, 'radiantGreninja', rootDirectory + '/resources/card-scans/radiantGreninja.webp', 'pokemon'],
    [1, 'zamazenta', rootDirectory + '/resources/card-scans/zamazenta.webp', 'pokemon'],
    [4, 'metal', rootDirectory + '/resources/card-scans/metal.webp', 'energy'],
    [4, 'water', rootDirectory + '/resources/card-scans/water.webp', 'energy'],
    [3, 'psychic', rootDirectory + '/resources/card-scans/psychic.webp', 'energy'],
    [4, 'colress\'sExperiment', rootDirectory + '/resources/card-scans/colress\'sExperiment.webp', 'supporter'],
    [4, 'battleVipPass', rootDirectory + '/resources/card-scans/battleVipPass.webp', 'item'],
    [4, 'mirageGate', rootDirectory + '/resources/card-scans/mirageGate.webp', 'item'],
    [4, 'switchCart', rootDirectory + '/resources/card-scans/switchCart.webp', 'item'],
    [3, 'escapeRope', rootDirectory + '/resources/card-scans/escapeRope.webp', 'item'],
    [4, 'nestBall', rootDirectory + '/resources/card-scans/nestBall.jpg', 'item'],
    [3, 'superRod', rootDirectory + '/resources/card-scans/superRod.webp', 'item'],
    [2, 'energyRecycler', rootDirectory + '/resources/card-scans/energyRecycler.webp', 'item'],
    [1, 'lostVacuum', rootDirectory + '/resources/card-scans/lostVacuum.webp', 'item'],
    [1, 'echoingHorn', rootDirectory + '/resources/card-scans/echoingHorn.jpg', 'item'],
    [1, 'hisuianHeavyBall', rootDirectory + '/resources/card-scans/hisuianHeavyBall.webp', 'item'],
    [1, 'roxanne', rootDirectory + '/resources/card-scans/roxanne.webp', 'supporter'],
    [1, 'artazon', rootDirectory + '/resources/card-scans/artazon.webp', 'stadium'],
    [1, 'pokestop', rootDirectory + '/resources/card-scans/pokestop.webp', 'stadium'],
    [1, 'beachCourt', rootDirectory + '/resources/card-scans/beachCourt.webp', 'stadium'],
    [2, 'forestSealStone', rootDirectory + '/resources/card-scans/forestSealStone.webp', 'tool']
];

export const deckData = cardData.map(card => assembleCard(...card));

function assembleCard(quantity, name, imageURL, type){

    const imageAttributes = {
        src: imageURL,
        alt: name,
        draggable: true,
        click: 'imageClick',
        dragstart: 'dragStart',
        dragover: 'dragOver',
        dragend: 'dragEnd',
        id: 'card'
    };

    const cardAttributes = {
        name: name,
        type: type
    };

    const rawCardAttributes = JSON.stringify(cardAttributes);
    const rawImageAttributes = JSON.stringify(imageAttributes);

    return [quantity, rawCardAttributes, rawImageAttributes];
}
